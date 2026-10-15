import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Appointment } from '../models/Appointment';
import { Client } from '../models/Client';
import { Product } from '../models/Product';
import { Service } from '../models/Service';
import { ReportArchive } from '../models/ReportArchive';
import { reportService } from '../services/reportService';

const getDateRange = (req: Request): { startDate: Date; endDate: Date } | null => {
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
        Client.count(),
        Product.count(),
        Service.count(),
        Appointment.count({ where: { scheduledAt: { [Op.gte]: startOfDay, [Op.lt]: startOfTomorrow } } }),
        reportService.getDashboardStats(),
      ]);
      res.json({
        clients,
        products,
        services,
        appointmentsToday,
        revenueToday: dashboard.todayRevenue,
        revenueTodayUSD: dashboard.todayRevenueUSD,
        revenueTodayCDF: dashboard.todayRevenueCDF,
        salesTodayUSDCount: dashboard.salesTodayUSDCount,
        salesTodayCDFCount: dashboard.salesTodayCDFCount,
        unclassifiedSalesToday: dashboard.unclassifiedSalesToday,
        amountReceivedTodayUSD: dashboard.amountReceivedTodayUSD,
        amountReceivedTodayCDF: dashboard.amountReceivedTodayCDF,
        servicesToday: dashboard.todayServiceCount,
        serviceRevenueToday: dashboard.todayServiceRevenue,
        serviceRevenueTodayUSD: dashboard.todayServiceRevenueUSD,
        serviceRevenueTodayCDF: dashboard.todayServiceRevenueCDF,
        productsSoldToday: dashboard.todayProductCount,
        productRevenueToday: dashboard.todayProductRevenue,
        productRevenueTodayUSD: dashboard.todayProductRevenueUSD,
        productRevenueTodayCDF: dashboard.todayProductRevenueCDF,
        unpaidCommissions: dashboard.unpaidCommissions,
        unpaidCommissionsUSD: dashboard.unpaidCommissionsUSD,
        unpaidCommissionsCDF: dashboard.unpaidCommissionsCDF,
      });
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

  archives: async (req: Request, res: Response) => {
    const kind = req.query.kind;
    if (kind != null && kind !== 'daily' && kind !== 'annual') return res.status(400).json({ error: 'Archive kind must be daily or annual' });
    try {
      return res.json(await ReportArchive.findAll({ where: kind ? { kind } : {}, order: [['periodStart', 'DESC']] }));
    } catch {
      return res.status(500).json({ error: 'Failed to load report archives' });
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
      const report = await reportService.getReportByPeriod(periodStart, periodEnd);
      const [archive, created] = await ReportArchive.findOrCreate({
        where: { kind: 'daily', periodKey: date },
        defaults: {
          kind: 'daily', periodKey: date, periodStart, periodEnd,
          totalSales: report.totalSales, amountReceived: report.amountReceived,
          outstandingAmount: report.outstandingAmount, serviceRevenue: report.serviceRevenue,
          productRevenue: report.productRevenue, totalExpenses: report.totalExpenses,
          netBalance: report.netBalance, totalCommissions: report.totalCommissions,
          transactionCount: report.transactionCount, expenseCount: report.expenseCount,
          closedAt: new Date(),
        },
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
      const report = await reportService.getReportByPeriod(periodStart, periodEnd);
      const [archive, created] = await ReportArchive.findOrCreate({
        where: { kind: 'annual', periodKey },
        defaults: {
          kind: 'annual', periodKey, periodStart, periodEnd,
          totalSales: report.totalSales, amountReceived: report.amountReceived,
          outstandingAmount: report.outstandingAmount, serviceRevenue: report.serviceRevenue,
          productRevenue: report.productRevenue, totalExpenses: report.totalExpenses,
          netBalance: report.netBalance, totalCommissions: report.totalCommissions,
          transactionCount: report.transactionCount, expenseCount: report.expenseCount,
          closedAt: new Date(),
        },
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