import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { commissionService } from '../services/commissionServices';
import { PayrollError, recordPayout, summarizePay } from '../services/payrollService';
import { actorOf, describeAmount, emitChange } from '../services/realtime';
import { currencies, isCurrency } from '../utils/money';
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

// Commissions are paid through the team payroll (advances and payments, /payroll): these routes
// read and write the same records, so there is a single source for what was paid.
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

  // Per currency: earned, paid (advances and payments) and remaining.
  getTotalByStaff: async (req: Request, res: Response) => {
    try {
      const { staffId } = req.params;
      if (!isUuid(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });
      const [pay] = await summarizePay([staffId]);
      if (!pay) return res.status(404).json({ error: 'Staff member not found' });
      res.json(Object.fromEntries(currencies.map((currency) => {
        const amounts = pay.byCurrency[currency];
        const earned = pay.payType === 'fixed' ? amounts.period.earned : amounts.total.earned;
        const paid = pay.payType === 'fixed'
          ? amounts.period.advances + amounts.period.payments
          : amounts.total.advances + amounts.total.payments;
        return [currency, { total: earned, paid: Math.round(paid * 100) / 100, remaining: amounts.remaining }];
      })));
    } catch (error) {
      res.status(500).json({ error: 'Failed to calculate commissions' });
    }
  },

  // Pays (part of) what is due to a member in one currency. Requires an Idempotency-Key header,
  // generated once per payment intent by the client: retrying with the same key returns the
  // original payment instead of paying twice.
  payCommission: async (req: AuthRequest, res: Response) => {
    const { staffId, amount, currency } = req.body ?? {};
    const paymentAmount = Number(amount);
    const idempotencyKey = req.get('Idempotency-Key');
    if (!isUuid(staffId) || !isCurrency(currency) || typeof amount === 'boolean' || !Number.isFinite(paymentAmount) || paymentAmount <= 0 ||
        paymentAmount > maxPaymentAmount || Math.abs(Math.round(paymentAmount * 100) - paymentAmount * 100) > 1e-6) {
      return res.status(400).json({ error: 'A staff ID, a currency (USD or CDF) and a positive payment amount are required' });
    }
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) {
      return res.status(400).json({ error: 'An Idempotency-Key header is required' });
    }
    try {
      const { payout, replayed } = await recordPayout({
        staffId, kind: 'payment', amount: paymentAmount, currency, paymentMethod: 'cash', note: null, idempotencyKey,
        paidByUserId: req.user?.id ?? null,
      });
      const [pay] = await summarizePay([staffId]);
      res.json({
        message: replayed ? 'Commission payment already processed' : 'Commission payment processed',
        paymentId: payout.id,
        currency: payout.currency,
        paid: Number(payout.amount),
        remaining: pay.byCurrency[currency].remaining,
        replayed,
      });
      if (!replayed) {
        emitChange({
          type: 'payroll.payout', entity: 'payout', entityId: payout.id, staffId, currency: payout.currency, amount: Number(payout.amount),
          summary: `Paiement versé à ${pay.name} – ${describeAmount(payout.amount, payout.currency)}`,
        }, actorOf(req.user));
      }
    } catch (error) {
      if (error instanceof PayrollError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Failed to pay commission' });
    }
  },
};
