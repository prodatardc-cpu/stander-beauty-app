import type { Request, Response } from 'express';
import { sequelize } from '../config/database';
import type { AuthRequest } from '../middleware/authMiddleware';
import { Attendance, type AttendanceStatus } from '../models/Attendance';
import { Staff } from '../models/Staff';
import { actorOf, emitChange } from '../services/realtime';
import { isUuid } from '../utils/validators';

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));

const getWorkDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || parsed.getUTCDay() === 0) return null;
  return value;
};

export const attendanceController = {
  listForDate: async (req: Request, res: Response) => {
    const date = getWorkDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'Choose a valid date from Monday to Saturday' });

    try {
      const records = await Attendance.findAll({ where: { attendanceDate: date } });
      res.json(records);
    } catch {
      res.status(500).json({ error: 'Failed to load attendance' });
    }
  },

  saveForDate: async (req: AuthRequest, res: Response) => {
    const date = getWorkDate(req.params.date);
    if (!date) return res.status(400).json({ error: 'Choose a valid date from Monday to Saturday' });
    if (!Array.isArray(req.body?.entries) || req.body.entries.length > 500) return res.status(400).json({ error: 'Attendance entries are required' });

    const entries: { staffId: string; status: AttendanceStatus }[] = [];
    for (const entry of req.body.entries as unknown[]) {
      if (!entry || typeof entry !== 'object') return res.status(400).json({ error: 'Invalid attendance entry' });
      const row = entry as { staffId?: unknown; status?: unknown };
      if (!isUuid(row.staffId) || !['present', 'absent'].includes(String(row.status))) {
        return res.status(400).json({ error: 'Each team member must be marked present or absent' });
      }
      entries.push({ staffId: row.staffId, status: row.status as AttendanceStatus });
    }

    if (new Set(entries.map((entry) => entry.staffId)).size !== entries.length) {
      return res.status(400).json({ error: 'A team member can only appear once' });
    }

    try {
      // Archived members are no longer part of the daily roll call.
      const staff = await Staff.findAll({ where: { archivedAt: null }, attributes: ['id'] });
      if (staff.length !== entries.length || staff.some((member) => !entries.some((entry) => entry.staffId === member.id))) {
        return res.status(400).json({ error: 'Mark every current team member before saving' });
      }

      await sequelize.transaction(async (transaction) => {
        for (const entry of entries) {
          const existing = await Attendance.findOne({
            where: { staffId: entry.staffId, attendanceDate: date },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (existing) {
            await existing.update({ status: entry.status }, { transaction });
          } else {
            await Attendance.create({ ...entry, attendanceDate: date }, { transaction });
          }
        }
      });

      res.json(await Attendance.findAll({ where: { attendanceDate: date } }));
      const present = entries.filter((entry) => entry.status === 'present').length;
      emitChange({
        type: 'attendance.saved', entity: 'attendance', entityId: date, day: date,
        summary: `Présences du ${dayLabel(date)} : ${present} présent${present > 1 ? 's' : ''}, ${entries.length - present} absent${entries.length - present > 1 ? 's' : ''}`,
      }, actorOf(req.user));
    } catch {
      res.status(500).json({ error: 'Failed to save attendance' });
    }
  },
};