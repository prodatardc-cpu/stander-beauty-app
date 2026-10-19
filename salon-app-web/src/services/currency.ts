import { useSyncExternalStore } from 'react';
import { apiClient } from './api';

export type Currency = 'USD' | 'CDF';
export type SalonSettings = {
  baseCurrency: Currency;
  usdToCdfRate: number | null;
  payPeriod: 'weekly' | 'monthly';
  // Printed at the top of receipts.
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  taxId: string | null;
  businessAddress: string | null;
};

// The base currency and the USD/CDF rate belong to the salon, not to a browser: they are read from
// the API (GET /settings) and changed by the administrator (PUT /settings) for every device at once.
const defaults: SalonSettings = {
  baseCurrency: 'USD', usdToCdfRate: null, payPeriod: 'monthly',
  businessName: 'Stander Beauty', businessEmail: null, businessPhone: null, taxId: null, businessAddress: null,
};
let settings: SalonSettings = defaults;
const listeners = new Set<() => void>();

const apply = (next: SalonSettings) => {
  settings = {
    ...defaults, ...next,
    baseCurrency: next.baseCurrency === 'CDF' ? 'CDF' : 'USD', usdToCdfRate: next.usdToCdfRate ? Number(next.usdToCdfRate) : null,
  };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Earlier versions kept these per browser; they are no longer read.
try {
  window.localStorage.removeItem('standerBeauty.currency');
  window.localStorage.removeItem('standerBeauty.usdToCdfRate');
} catch {
  // Storage unavailable: nothing to clean.
}

export const loadSettings = async () => {
  const { data } = await apiClient.get<SalonSettings>('/settings');
  apply(data);
};

// Administrator only. Changing the base currency converts catalogue prices at the rate (server side).
export const saveSettings = async (changes: Partial<SalonSettings>) => {
  const { data } = await apiClient.put<SalonSettings>('/settings', changes);
  apply(data);
  return settings;
};

export const useCurrency = (): Currency => useSyncExternalStore(subscribe, () => settings.baseCurrency, () => defaults.baseCurrency);
export const useExchangeRate = (): number | null => useSyncExternalStore(subscribe, () => settings.usdToCdfRate, () => defaults.usdToCdfRate);
export const useSalonSettings = (): SalonSettings => useSyncExternalStore(subscribe, () => settings, () => defaults);

// Same rounding as the API (salon-app-backend/src/utils/money.ts): to the cent in USD, to the franc
// in CDF. Sale prices computed here must match the server's to the unit.
export const roundMoney = (value: number, currency: Currency) =>
  currency === 'CDF' ? Math.round(value) : Math.round(value * 100) / 100;

export const convertMoney = (amount: number, from: Currency, to: Currency, usdToCdfRate: number) => {
  if (from === to) return amount;
  return from === 'USD' ? amount * usdToCdfRate : amount / usdToCdfRate;
};

const formatSingleCurrency = (value: number, currency: Currency) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'CDF' ? 0 : 2,
    maximumFractionDigits: currency === 'CDF' ? 0 : 2,
  }).format(value);

export const formatCurrencyExact = (value: number | string, currency: Currency) =>
  formatSingleCurrency(Number(value), currency);

// An amount in its own currency. Amounts are never shown converted into the other currency: the
// only conversion is the one the cashier chooses explicitly at the till, with the rate displayed.
export const formatCurrency = (value: number | string, currency: Currency) => formatSingleCurrency(Number(value), currency);

export const currencyLabels: Record<Currency, string> = { USD: 'Dollar américain (USD)', CDF: 'Franc congolais (CDF)' };
