import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { CashAdjustment, CashCount } from '../models';
import { historyService } from '../services/historyService';
import { collectPeriod, dayKey, dayRange, journalOf } from '../services/operationsService';
import { PayrollError, recordPayout, staffActivity, summarizePay } from '../services/payrollService';
import { actorOf, describeAmount, emitChange } from '../services/realtime';
import { isCurrency, roundMoney } from '../utils/money';
import { isUuid } from '../utils/validators';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const paymentMethods = ['cash', 'momo', 'card', 'transfer', 'other'];
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,100}$/;
const maxAmount = 9_999_999_999;

const isValidDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

// A positive amount with at most two decimals (whole francs are entered as such).
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 &&
  value <= maxAmount && Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

const optionalText = (value: unknown, max: number) =>
  value == null || value === '' ? { value: null } : typeof value === 'string' && value.length <= max ? { value: value.trim() || null } : null;

export const operationsController = {
  // GET /history/days?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 60 days).
  historyDays: async (req: Request, res: Response) => {
    const today = dayKey(new Date());
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 59);
    const from = req.query.from ?? dayKey(defaultFrom);
    const to = req.query.to ?? today;
    if (!isValidDay(from) || !isValidDay(to) || from > to) return res.status(400).json({ error: 'Valid from and to dates are required' });
    const span = (dayRange(to).start.getTime() - dayRange(from).start.getTime()) / 86_400_000;
    if (span > 400) return res.status(400).json({ error: 'The period cannot exceed 400 days' });
    try {
      res.json({ from, to, days: await historyService.days(from, to) });
    } catch {
      res.status(500).json({ error: 'Failed to load the history' });
    }
  },

  historyDay: async (req: Request, res: Response) => {
    const day = req.params.day;
    if (!isValidDay(day)) return res.status(400).json({ error: 'A valid date in YYYY-MM-DD format is required' });
    try {
      res.json(await historyService.day(day));
    } catch {
      res.status(500).json({ error: 'Failed to load this day' });
    }
  },

  // A cash entry or withdrawal that is not a sale, an expense or a payout.
  createAdjustment: async (req: AuthRequest, res: Response) => {
    const { direction, amount, currency, paymentMethod = 'cash', reason } = req.body ?? {};
    const text = optionalText(reason, 255);
    if (!['in', 'out'].includes(direction) || !isAmount(amount) || !isCurrency(currency) || !paymentMethods.includes(paymentMethod) || !text?.value) {
      return res.status(400).json({ error: 'Direction, a positive amount, a currency and a reason are required' });
    }
    try {
      const adjustment = await CashAdjustment.create({
        direction, amount: roundMoney(amount, currency), currency, paymentMethod, reason: text.value, userId: req.user?.id ?? null,
      });
      res.status(201).json(adjustment);
      emitChange({
        type: 'cash.adjustment', entity: 'cash', entityId: adjustment.id, currency, amount: Number(adjustment.amount),
        summary: `${direction === 'in' ? 'Entrée' : 'Sortie'} de caisse : ${adjustment.reason} – ${describeAmount(adjustment.amount, currency)}`,
      }, actorOf(req.user));
    } catch {
      res.status(500).json({ error: 'Failed to record the cash movement' });
    }
  },

  // Records the cash counted in the drawer against the day's theoretical cash balance in that currency.
  createCount: async (req: AuthRequest, res: Response) => {
    const { day = dayKey(new Date()), currency, countedAmount, note } = req.body ?? {};
    const text = optionalText(note, 255);
    if (!isValidDay(day) || day > dayKey(new Date()) || !isCurrency(currency) || typeof countedAmount !== 'number' ||
        !Number.isFinite(countedAmount) || countedAmount < 0 || countedAmount > maxAmount || !text) {
      return res.status(400).json({ error: 'A day, a currency and the counted amount are required' });
    }
    try {
      const { start, end } = dayRange(day);
      const journal = journalOf(await collectPeriod(start, end));
      const expected = journal
        .filter((entry) => entry.currency === currency && entry.paymentMethod === 'cash')
        .reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount : -entry.amount), 0);
      const count = await CashCount.create({
        day, currency, expectedAmount: roundMoney(expected, currency), countedAmount: roundMoney(countedAmount, currency),
        note: text.value, userId: req.user?.id ?? null,
      });
      const difference = roundMoney(Number(count.countedAmount) - Number(count.expectedAmount), currency);
      res.status(201).json({ ...count.toJSON(), difference });
      emitChange({
        type: 'cash.count', entity: 'cash', entityId: count.id, currency, amount: Number(count.countedAmount), day,
        summary: `Comptage de caisse : ${describeAmount(count.countedAmount, currency)} compté, ${describeAmount(count.expectedAmount, currency)} attendu` +
          (difference === 0 ? ' (sans écart)' : ` (écart ${difference > 0 ? '+' : '−'}${describeAmount(Math.abs(difference), currency)})`),
      }, actorOf(req.user));
    } catch {
      res.status(500).json({ error: 'Failed to record the cash count' });
    }
  },

  // Pay summary of every member (administrator).
  team: async (_req: Request, res: Response) => {
    try {
      res.json(await summarizePay());
    } catch {
      res.status(500).json({ error: 'Failed to load team pay' });
    }
  },

  // One member's page: pay summary, services performed and payouts.
  member: async (req: Request, res: Response) => {
    const staffId = req.params.staffId;
    if (!isUuid(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });
    try {
      const [pay] = await summarizePay([staffId]);
      if (!pay) return res.status(404).json({ error: 'Staff member not found' });
      res.json({ ...pay, ...(await staffActivity(staffId)) });
    } catch {
      res.status(500).json({ error: 'Failed to load this member' });
    }
  },

  // POST /payroll/:staffId/payouts { kind, amount, currency, paymentMethod, note } + Idempotency-Key.
  pay: async (req: AuthRequest, res: Response) => {
    const staffId = req.params.staffId;
    const { kind, amount, currency, paymentMethod = 'cash', note } = req.body ?? {};
    const idempotencyKey = req.get('Idempotency-Key');
    const text = optionalText(note, 255);
    if (!isUuid(staffId) || !['advance', 'payment'].includes(kind) || !isAmount(amount) || !isCurrency(currency) ||
        !paymentMethods.includes(paymentMethod) || !text) {
      return res.status(400).json({ error: 'A kind (advance or payment), a positive amount and a currency are required' });
    }
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) return res.status(400).json({ error: 'An Idempotency-Key header is required' });
    try {
      const { payout, replayed } = await recordPayout({
        staffId, kind, amount: roundMoney(amount, currency), currency, paymentMethod, note: text.value, idempotencyKey,
        paidByUserId: req.user?.id ?? null,
      });
      const [pay] = await summarizePay([staffId]);
      res.status(replayed ? 200 : 201).json({ payout, replayed, pay });
      if (!replayed) {
        emitChange({
          type: 'payroll.payout', entity: 'payout', entityId: payout.id, staffId, currency: payout.currency, amount: Number(payout.amount),
          summary: `${payout.kind === 'advance' ? 'Avance versée' : 'Paiement versé'} à ${pay?.name ?? 'un membre de l’équipe'} – ${describeAmount(payout.amount, payout.currency)}`,
        }, actorOf(req.user));
      }
    } catch (error) {
      if (error instanceof PayrollError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Failed to record the payment' });
    }
  },
};
