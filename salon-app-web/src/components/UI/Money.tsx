import type { Currency } from '../../services/currency';
import { formatCurrency } from '../../services/currency';

// Colour code of the financial figures: profit in green, expenses in amber, sold-out products and
// money going out in red. Amounts are always shown in their own currency.
export type MoneyTone = 'profit' | 'expense' | 'danger' | 'muted';

export const Money = ({ value, currency, tone }: { value: number | string | null | undefined; currency: Currency; tone?: MoneyTone }) => (
  <span className={`money${tone ? ` tone-${tone}` : ''}`}>{value === null || value === undefined ? '—' : formatCurrency(value, currency)}</span>
);

// One line per currency that has a value (or the first one when both are zero), never added together.
export const MoneyByCurrency = ({ values, tone, currencies = ['USD', 'CDF'] }: {
  values: Partial<Record<Currency, number | null>>; tone?: MoneyTone; currencies?: Currency[];
}) => {
  const shown = currencies.filter((currency) => Number(values[currency] ?? 0) !== 0);
  const list = shown.length ? shown : currencies.slice(0, 1);
  return (
    <span className="money-stack">
      {list.map((currency) => <Money key={currency} value={values[currency] ?? 0} currency={currency} tone={tone} />)}
    </span>
  );
};
