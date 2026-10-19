import type { Transaction } from 'sequelize';
import { sequelize } from '../config/database';
import { SalonSettings } from '../models';
import type { Currency } from '../utils/money';

export type BusinessDetails = {
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  taxId: string | null;
  businessAddress: string | null;
};
export type Settings = BusinessDetails & {
  baseCurrency: Currency;
  usdToCdfRate: number | null;
  payPeriod: 'weekly' | 'monthly';
  updatedAt: Date | null;
};
export const businessFields = ['businessName', 'businessEmail', 'businessPhone', 'taxId', 'businessAddress'] as const;

export class SettingsError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const toSettings = (row: SalonSettings | null): Settings => ({
  baseCurrency: row?.baseCurrency ?? 'USD',
  usdToCdfRate: row?.usdToCdfRate == null ? null : Number(row.usdToCdfRate),
  payPeriod: row?.payPeriod === 'weekly' ? 'weekly' : 'monthly',
  businessName: row?.businessName ?? 'Stander Beauty',
  businessEmail: row?.businessEmail ?? null,
  businessPhone: row?.businessPhone ?? null,
  taxId: row?.taxId ?? null,
  businessAddress: row?.businessAddress ?? null,
  updatedAt: row?.updatedAt ?? null,
});

// Amounts stored in the base currency, converted when it changes so that they keep their value.
const baseCurrencyColumns: { table: string; columns: string[] }[] = [
  { table: 'services', columns: ['price', 'womenPrice', 'menPrice'] },
  { table: 'products', columns: ['priceBuy', 'priceSell'] },
  { table: 'staff', columns: ['monthlySalary'] },
  { table: 'clients', columns: ['totalSpent'] },
];

export const settingsService = {
  // The row is created by migration 006; until then (or in an emptied test database) USD and no rate.
  get: async (transaction?: Transaction): Promise<Settings> =>
    toSettings(await SalonSettings.findByPk(1, { transaction, ...(transaction && { lock: transaction.LOCK.SHARE }) })),

  update: async (changes: Partial<BusinessDetails> & { baseCurrency?: Currency; usdToCdfRate?: number | null; payPeriod?: 'weekly' | 'monthly' }, userId: string | null) =>
    sequelize.transaction(async (transaction) => {
      await sequelize.query('INSERT INTO "salon_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING', { transaction });
      const row = (await SalonSettings.findByPk(1, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const current = toSettings(row);
      const rate = changes.usdToCdfRate !== undefined ? changes.usdToCdfRate : current.usdToCdfRate;
      const baseCurrency = changes.baseCurrency ?? current.baseCurrency;

      if (baseCurrency !== current.baseCurrency) {
        if (!rate) throw new SettingsError(400, 'An exchange rate is required to change the base currency');
        // USD -> CDF multiplies by the rate and rounds to the franc; CDF -> USD divides and rounds to the cent.
        const expression = (column: string) => baseCurrency === 'CDF'
          ? `ROUND("${column}" * :rate, 0)`
          : `ROUND("${column}" / :rate, 2)`;
        for (const { table, columns } of baseCurrencyColumns) {
          await sequelize.query(
            `UPDATE "${table}" SET ${columns.map((column) => `"${column}" = ${expression(column)}`).join(', ')}`,
            { replacements: { rate }, transaction }
          );
        }
      }

      const details = Object.fromEntries(businessFields.filter((field) => changes[field] !== undefined).map((field) => [field, changes[field]]));
      await row.update({
        ...details, baseCurrency, usdToCdfRate: rate, updatedByUserId: userId,
        ...(changes.payPeriod && { payPeriod: changes.payPeriod }),
      }, { transaction });
      return toSettings(row);
    }),
};
