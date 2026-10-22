import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { Op } from 'sequelize';
import { Expense } from '../models';
import { dayKey } from '../services/operationsService';
import { actorOf, describeAmount, emitChange } from '../services/realtime';
import { settingsService } from '../services/settingsService';
import { isCurrency } from '../utils/money';
import { isText } from '../utils/validators';

const paymentMethods = ['cash', 'momo', 'card', 'transfer', 'other'];
// amount is DECIMAL(10, 2).
const maxAmount = 99_999_999.99;
const hasAtMostTwoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

export const expenseController = {
  list: async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;
    if ((startDate !== undefined || endDate !== undefined) && (typeof startDate !== 'string' || typeof endDate !== 'string' || !Number.isFinite(new Date(startDate).getTime()) || !Number.isFinite(new Date(endDate).getTime()))) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    try {
      const where = typeof startDate === 'string' && typeof endDate === 'string'
        ? { createdAt: { [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59.999`)] } }
        : {};
      const expenses = await Expense.findAll({ where, order: [['createdAt', 'DESC']], ...(Object.keys(where).length ? {} : { limit: 100 }) });
      return res.json(expenses);
    } catch {
      return res.status(500).json({ error: 'Failed to fetch expenses' });
    }
  },

  create: async (req: AuthRequest, res: Response) => {
    const { description, category, amount, paymentMethod, currency } = req.body ?? {};
    if (!isText(description, 255) || !isText(category, 100) || typeof amount === 'boolean' ||
        !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > maxAmount || !hasAtMostTwoDecimals(Number(amount)) ||
        !paymentMethods.includes(paymentMethod) || (currency != null && !isCurrency(currency))) {
      return res.status(400).json({ error: 'Description, category, positive amount, payment method and currency (USD or CDF) are required' });
    }
    try {
      // Paid in the salon's base currency unless the cashier says otherwise.
      const expenseCurrency = currency ?? (await settingsService.get()).baseCurrency;
      const expense = await Expense.create({ description: description.trim(), category: category.trim(), amount: Number(amount), currency: expenseCurrency, paymentMethod, createdByUserId: req.user?.id ?? null });
      res.status(201).json(expense);
      emitChange({
        type: 'expense.created', entity: 'expense', entityId: expense.id, currency: expenseCurrency, amount: Number(expense.amount),
        summary: `Dépense : ${expense.description} – ${describeAmount(expense.amount, expenseCurrency)}`,
      }, actorOf(req.user));
      return;
    } catch {
      return res.status(400).json({ error: 'Failed to create expense' });
    }
  },

  // An expense entered by mistake is cancelled, never erased: it stays in the history with who
  // cancelled it, when and why, and its amount comes back into the cash journal on that day.
  cancel: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const reason = req.body?.reason;
    if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid expense ID' });
    if (reason != null && (typeof reason !== 'string' || reason.length > 255)) return res.status(400).json({ error: 'The reason must be at most 255 characters' });
    try {
      const [cancelled] = await Expense.update(
        { cancelledAt: new Date(), cancelledByUserId: req.user?.id ?? null, cancelReason: typeof reason === 'string' && reason.trim() ? reason.trim() : null },
        { where: { id, cancelledAt: null } }
      );
      if (!cancelled) {
        const exists = await Expense.findByPk(id);
        return exists ? res.status(409).json({ error: 'Expense already cancelled' }) : res.status(404).json({ error: 'Expense not found' });
      }
      const expense = await Expense.findByPk(id);
      res.json({ success: true, expense });
      if (expense) {
        const currency = isCurrency(expense.currency) ? expense.currency : null;
        emitChange({
          type: 'expense.cancelled', entity: 'expense', entityId: id, currency, amount: currency ? Number(expense.amount) : null,
          day: dayKey(expense.createdAt),
          summary: `Dépense annulée : ${expense.description}${currency ? ` – ${describeAmount(expense.amount, currency)}` : ''}` +
            (expense.cancelReason ? ` (${expense.cancelReason})` : ''),
        }, actorOf(req.user));
      }
      return;
    } catch {
      return res.status(500).json({ error: 'Failed to cancel expense' });
    }
  },
};