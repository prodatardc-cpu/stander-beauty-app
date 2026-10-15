import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Expense } from '../models';
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

  create: async (req: Request, res: Response) => {
    const { description, category, amount, paymentMethod } = req.body ?? {};
    if (!isText(description, 255) || !isText(category, 100) || typeof amount === 'boolean' ||
        !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > maxAmount || !hasAtMostTwoDecimals(Number(amount)) ||
        !paymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Description, category, positive amount and payment method are required' });
    }
    try {
      const expense = await Expense.create({ description: description.trim(), category: category.trim(), amount: Number(amount), paymentMethod });
      return res.status(201).json(expense);
    } catch {
      return res.status(400).json({ error: 'Failed to create expense' });
    }
  },

  remove: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid expense ID' });
    try {
      const deleted = await Expense.destroy({ where: { id } });
      if (!deleted) return res.status(404).json({ error: 'Expense not found' });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to delete expense' });
    }
  },
};