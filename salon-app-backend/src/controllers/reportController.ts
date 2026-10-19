import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Appointment } from '../models/Appointment';
import { Attendance } from '../models/Attendance';
import { Client } from '../models/Client';
import { Product } from '../models/Product';
import { Service } from '../models/Service';
import { Staff } from '../models/Staff';
import { policy, type Role } from '../config/permissions';
import type { AuthRequest } from '../middleware/authMiddleware';
import { ReportArchive } from '../models/ReportArchive';
import { reportService } from '../services/reportService';
import { settingsService } from '../services/settingsService';
import { isCurrency } from '../utils/money';
import { isUuid } from '../utils/validators';

// Freezes the figures of a period. The summary columns hold the base-currency figures; breakdown
// keeps both currencies (and the sales recorded without one).
const archiveDefaults = async (kind: 'daily' | 'annual', periodKey: string, periodStart: Date, periodEnd: Date) => {
  const [report, settings] = await Promise.all([reportService.getReportByPeriod(periodStart, periodEnd), settingsService.get()]);
  return {
    kind, periodKey, periodStart, periodEnd,
    ...report.byCurrency[settings.baseCurrency],
    breakdown: { baseCurrency: settings.baseCurrency, byCurrency: report.byCurrency, unclassifiedSales: report.unclassifiedSales },
    closedAt: new Date(),
  };
};

export const getDateRange = (req: Request): { startDate: Date; endDate: Date } | null => {
  const { startDate, endDate } = req.query;
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return null;

  const parseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : new Date(Number.NaN);
  };
  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  if (!Number.isFinite(parsedStart.getTime()) || !Number.isFinite(parsedEnd.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) parsedEnd.setHours(23, 59, 59, 999);
  if (parsedStart > parsedEnd) return null;
  return { startDate: parsedStart, endDate: parsedEnd };
};

const invalidDateRange = (res: Response) =>
  res.status(400).json({ error: 'Valid startDate and endDate query parameters are required' });

export const reportController = {
  overview: async (_req: Request, res: Response) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startOfTomorrow = new Date(startOfDay);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
      const [clients, products, services, appointmentsToday, dashboard] = await Promise.all([
        Client.count({ where: { archivedAt: null } }),
        Product.count(),
        Service.count({ where: { status: 'active' } }),
        Appointment.count({ where: { scheduledAt: { [Op.gte]: startOfDay, [Op.lt]: startOfTomorrow } } }),
        reportService.getDashboardStats(),
      ]);
      res.json({ clients, products, services, appointmentsToday, ...dashboard });
    } catch {
      res.status(500).json({ error: 'Failed to load dashboard report' });
    }
  },

  byPeriod: async (req: Request, res: Response) => {
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getReportByPeriod(range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load period report' });
    }
  },

  // Filters: staffId, type (service|product), currency.
  sales: async (req: Request, res: Response) => {
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    const { staffId, type, currency } = req.query;
    if ((staffId !== undefined && !isUuid(staffId)) || (type !== undefined && type !== 'service' && type !== 'product') ||
        (currency !== undefined && !isCurrency(currency))) {
      return res.status(400).json({ error: 'Invalid report filters' });
    }
    try {
      res.json(await reportService.getSalesReport(range.startDate, range.endDate, {
        staffId: staffId as string | undefined, type: type as 'service' | 'product' | undefined, currency: currency as 'USD' | 'CDF' | undefined,
      }));
    } catch {
      res.status(500).json({ error: 'Failed to load sales report' });
    }
  },

  cash: async (req: Request, res: Response) => {
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getCashReport(range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load cash report' });
    }
  },

  // status: open (default) | settled | all; currency optional.
  debts: async (req: Request, res: Response) => {
    const status = req.query.status ?? 'open';
    const { currency } = req.query;
    if (!['open', 'settled', 'all'].includes(String(status)) || (currency !== undefined && !isCurrency(currency))) {
      return res.status(400).json({ error: 'Invalid report filters' });
    }
    try {
      res.json(await reportService.getDebtsReport(status as 'open' | 'settled' | 'all', currency as 'USD' | 'CDF' | undefined));
    } catch {
      res.status(500).json({ error: 'Failed to load debts report' });
    }
  },

  team: async (req: Request, res: Response) => {
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getTeamReport(range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load team report' });
    }
  },

  archives: async (req: Request, res: Response) => {
    const kind = req.query.kind;
    if (kind != null && kind !== 'daily' && kind !== 'annual') return res.status(400).json({ error: 'Archive kind must be daily or annual' });
    try {
      return res.json(await ReportArchive.findAll({ where: kind ? { kind } : {}, order: [['periodStart', 'DESC']] }));
    } catch {
      return res.status(500).json({ error: 'Failed to load report archives' });
    }
  },

  // Roll call of the period (attendance list): one row per current member, and per archived member
  // who was marked during the period, with the days present and absent.
  attendance: async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;
    const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isDay(startDate) || !isDay(endDate) || startDate > endDate) return invalidDateRange(res);
    try {
      const [records, staff] = await Promise.all([
        Attendance.findAll({ where: { attendanceDate: { [Op.between]: [startDate, endDate] } }, order: [['attendanceDate', 'ASC']] }),
        Staff.findAll({ order: [['name', 'ASC']] }),
      ]);
      const rows = staff
        .map((member) => {
          const days = records.filter((record) => record.staffId === member.id).map((record) => ({ date: record.attendanceDate, status: record.status }));
          return {
            staffId: member.id, name: member.name, position: member.position, archived: Boolean(member.archivedAt), days,
            present: days.filter((day) => day.status === 'present').length, absent: days.filter((day) => day.status === 'absent').length,
          };
        })
        .filter((row) => !row.archived || row.days.length);
      return res.json({ recordedDays: new Set(records.map((record) => record.attendanceDate)).size, staff: rows });
    } catch {
      return res.status(500).json({ error: 'Failed to load attendance report' });
    }
  },

  // Removes a closure only: the period's sales, expenses and payments are kept and the period can be closed again.
  deleteArchive: async (req: AuthRequest, res: Response) => {
    try {
      const archive = await ReportArchive.findByPk(String(req.params.id));
      if (!archive) return res.status(404).json({ error: 'Report archive not found' });
      const allowed: readonly Role[] = archive.kind === 'annual' ? policy.closeYear : policy.closeDay;
      if (!req.user || !allowed.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
      await archive.destroy();
      return res.json({ message: 'Report archive deleted' });
    } catch {
      return res.status(500).json({ error: 'Failed to delete the report archive' });
    }
  },

  closeDay: async (req: Request, res: Response) => {
    const date = req.body?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid date in YYYY-MM-DD format is required' });
    const [year, month, day] = date.split('-').map(Number);
    const periodStart = new Date(year, month - 1, day);
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (periodStart.getFullYear() !== year || periodStart.getMonth() !== month - 1 || periodStart.getDate() !== day || date > localToday) {
      return res.status(400).json({ error: 'The report date must be a valid day that has started' });
    }
    const periodEnd = new Date(year, month - 1, day + 1);
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
    try {
      const [archive, created] = await ReportArchive.findOrCreate({
        where: { kind: 'daily', periodKey: date },
        defaults: await archiveDefaults('daily', date, periodStart, periodEnd),
      });
      return res.status(created ? 201 : 200).json({ archive, alreadyClosed: !created });
    } catch {
      return res.status(500).json({ error: 'Failed to close the daily report' });
    }
  },

  closeYear: async (req: Request, res: Response) => {
    const rawYear = req.body?.year;
    const year = typeof rawYear === 'number' ? rawYear : Number(rawYear);
    const now = new Date();
    const yearHasEnded = year < now.getFullYear() || (year === now.getFullYear() && now.getMonth() === 11 && now.getDate() === 31);
    if (!Number.isInteger(year) || year < 2000 || !yearHasEnded) return res.status(400).json({ error: 'Only a completed financial year can be closed' });
    const periodKey = String(year);
    const periodStart = new Date(year, 0, 1);
    const periodEnd = new Date(year + 1, 0, 1);
    periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
    try {
      const [archive, created] = await ReportArchive.findOrCreate({
        where: { kind: 'annual', periodKey },
        defaults: await archiveDefaults('annual', periodKey, periodStart, periodEnd),
      });
      return res.status(created ? 201 : 200).json({ archive, alreadyClosed: !created, historyPreserved: true });
    } catch {
      return res.status(500).json({ error: 'Failed to close the annual report' });
    }
  },

  byStaff: async (req: Request, res: Response) => {
    const { staffId } = req.params;
    if (typeof staffId !== 'string') return res.status(400).json({ error: 'Invalid staff ID' });
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getReportByStaff(staffId, range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load staff report' });
    }
  },

  byService: async (req: Request, res: Response) => {
    const { serviceId } = req.params;
    if (typeof serviceId !== 'string') return res.status(400).json({ error: 'Invalid service ID' });
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getReportByService(serviceId, range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load service report' });
    }
  },

  byProduct: async (req: Request, res: Response) => {
    const { productId } = req.params;
    if (typeof productId !== 'string') return res.status(400).json({ error: 'Invalid product ID' });
    const range = getDateRange(req);
    if (!range) return invalidDateRange(res);
    try {
      res.json(await reportService.getReportByProduct(productId, range.startDate, range.endDate));
    } catch {
      res.status(500).json({ error: 'Failed to load product report' });
    }
  },
};
