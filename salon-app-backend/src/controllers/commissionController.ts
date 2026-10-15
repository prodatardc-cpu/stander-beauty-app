import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { CommissionPaymentError, commissionService } from '../services/commissionServices';
import { isUuid } from '../utils/validators';

const maxPaymentAmount = 1_000_000_000;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,100}$/;

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
      if (!isUuid(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });
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
      if (!isUuid(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });
      const totals = await commissionService.getStaffCommissionTotals(staffId);
      res.json(totals);
    } catch (error) {
      res.status(500).json({ error: 'Failed to calculate commissions' });
    }
  },

  // Requires an Idempotency-Key header, generated once per payment intent by the client:
  // retrying with the same key returns the original payment instead of paying twice.
  payCommission: async (req: AuthRequest, res: Response) => {
    const { staffId, amount } = req.body ?? {};
    const paymentAmount = Number(amount);
    const idempotencyKey = req.get('Idempotency-Key');
    if (!isUuid(staffId) || typeof amount === 'boolean' || !Number.isFinite(paymentAmount) || paymentAmount <= 0 ||
        paymentAmount > maxPaymentAmount || Math.abs(Math.round(paymentAmount * 100) - paymentAmount * 100) > 1e-6) {
      return res.status(400).json({ error: 'A staff ID and a positive payment amount are required' });
    }
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) {
      return res.status(400).json({ error: 'An Idempotency-Key header is required' });
    }
    try {
      const { payment, remaining, replayed } = await commissionService.payStaffCommissions({
        staffId, amount: paymentAmount, idempotencyKey, paidByUserId: req.user?.id ?? null,
      });
      res.json({
        message: replayed ? 'Commission payment already processed' : 'Commission payment processed',
        paymentId: payment.id,
        paid: Number(payment.amount),
        commissionCount: payment.commissionCount,
        remaining,
        replayed,
      });
    } catch (error) {
      if (error instanceof CommissionPaymentError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Failed to pay commission' });
    }
  },
};
