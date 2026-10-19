export const currencies = ['USD', 'CDF'] as const;
export type Currency = (typeof currencies)[number];

export const isCurrency = (value: unknown): value is Currency => currencies.includes(value as Currency);

// Amounts are kept to the cent in USD and to the whole franc in CDF. The web app rounds sale prices
// the same way (salon-app-web/src/services/currency.ts), so both sides agree on a sale's total.
export const roundMoney = (value: number, currency: Currency) =>
  currency === 'CDF' ? Math.round(value) : Math.round(value * 100) / 100;

// usdToCdfRate: how many CDF one USD buys.
export const convertMoney = (amount: number, from: Currency, to: Currency, usdToCdfRate: number) => {
  if (from === to) return amount;
  return from === 'USD' ? amount * usdToCdfRate : amount / usdToCdfRate;
};

// Sums `amount(row)` per currency, rounded; rows without a currency (recorded before currencies
// were tracked) are left out and counted separately by the callers that need it.
export const sumByCurrency = <T>(rows: T[], currencyOf: (row: T) => string | null | undefined, amount: (row: T) => number) => {
  const totals: Record<Currency, number> = { USD: 0, CDF: 0 };
  for (const row of rows) {
    const currency = currencyOf(row);
    if (isCurrency(currency)) totals[currency] += amount(row);
  }
  return { USD: roundMoney(totals.USD, 'USD'), CDF: roundMoney(totals.CDF, 'CDF') };
};
