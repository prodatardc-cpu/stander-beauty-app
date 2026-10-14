import type { Request, Response } from 'express';
import { commissionService } from '../services/commissionServices';

const getDateRange = (req: Request): { startDate?: Date; endDate?: Date } | null => {
  const { startDate, endDate } = req.query;
  if (startDate === undefined && endDate === undefined) return {};
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return null;

  const parsedStart = new Date(startDate);
  const parsedEnd = new Date(endDate);
  if (!Number.isFinite(parsedStart.getTime()) || !Number.isFinite(parsedEnd.getTime()) || parsedStart > parsedEnd) {
    return null;
  }
  return { startDate: parsedStart, endDate: parsedEnd };
};

export const commissionController = {
  getByStaff: async (req: Request, res: Response) => {
    try {
      const { staffId } = req.params;
      if (typeof staffId !== 'string') return res.status(400).json({ error: 'Invalid staff ID' });
      const range = getDateRange(req);
      if (!range) return res.status(400).json({ error: 'Invalid date range' });
      const commissions = await commissionService.getStaffCommissions(staffId, range.startDate, range.endDate);

      res.json(commissions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch commissions' });
    }
  },

  getTotalByStaff: async (req: Request, res: Response) => {
    try {
      const { staffId } = req.params;
      if (typeof staffId !== 'string') return res.status(400).json({ error: 'Invalid staff ID' });
      const totals = await commissionService.getStaffCommissionTotals(staffId);
      res.json(totals);
    } catch (error) {
      res.status(500).json({ error: 'Failed to calculate commissions' });
    }
  },

  payCommission: async (req: Request, res: Response) => {
    try {
      const { staffId, amount } = req.body;
      const paymentAmount = Number(amount);
      if (typeof staffId !== 'string' || !staffId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({ error: 'A staff ID and a positive payment amount are required' });
      }
      const result = await commissionService.payStaffCommissions(staffId, paymentAmount);
      res.json({ message: 'Commission payment processed', ...result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to pay commission' });
    }
  },
};