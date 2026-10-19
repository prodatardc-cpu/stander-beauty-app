import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { businessFields, SettingsError, settingsService } from '../services/settingsService';
import { isCurrency } from '../utils/money';

const maxRate = 1_000_000;
const fieldLimits: Record<(typeof businessFields)[number], number> = {
  businessName: 120, businessEmail: 254, businessPhone: 40, taxId: 60, businessAddress: 255,
};

// Business details: trimmed text within its limit, or null/empty to clear (the name is required).
const businessError = (body: Record<string, unknown>) => {
  for (const field of businessFields) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      if (field === 'businessName') return 'The business name is required';
      continue;
    }
    if (typeof value !== 'string' || !value.trim() || value.length > fieldLimits[field]) return 'Invalid business details';
    if (field === 'businessEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Invalid business email';
  }
  return null;
};

export const settingsController = {
  get: async (_req: Request, res: Response) => {
    try {
      res.json(await settingsService.get());
    } catch {
      res.status(500).json({ error: 'Failed to load settings' });
    }
  },

  // Changing the base currency converts catalogue prices, salaries and client totals at the rate.
  update: async (req: AuthRequest, res: Response) => {
    const body = req.body ?? {};
    const unknown = Object.keys(body).filter((field) => !['baseCurrency', 'usdToCdfRate', 'payPeriod', ...businessFields].includes(field));
    const { baseCurrency, usdToCdfRate } = body;
    if (unknown.length || (baseCurrency !== undefined && !isCurrency(baseCurrency)) ||
        (usdToCdfRate !== undefined && usdToCdfRate !== null &&
          (typeof usdToCdfRate !== 'number' || !Number.isFinite(usdToCdfRate) || usdToCdfRate <= 0 || usdToCdfRate > maxRate))) {
      return res.status(400).json({ error: 'Base currency must be USD or CDF and the rate a positive number' });
    }
    if (body.payPeriod !== undefined && !['weekly', 'monthly'].includes(body.payPeriod)) {
      return res.status(400).json({ error: 'Pay period must be weekly or monthly' });
    }
    const invalidDetails = businessError(body);
    if (invalidDetails) return res.status(400).json({ error: invalidDetails });
    const details = Object.fromEntries(businessFields.filter((field) => body[field] !== undefined)
      .map((field) => [field, typeof body[field] === 'string' && body[field].trim() ? body[field].trim() : null]));
    try {
      res.json(await settingsService.update({ ...details, baseCurrency, usdToCdfRate, payPeriod: body.payPeriod }, req.user?.id ?? null));
    } catch (error) {
      if (error instanceof SettingsError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Failed to update settings' });
    }
  },
};
