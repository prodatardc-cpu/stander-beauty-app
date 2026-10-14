import { useSyncExternalStore } from 'react';

export type Currency = 'USD' | 'CDF';

const storageKey = 'standerBeauty.currency';
const exchangeRateStorageKey = 'standerBeauty.usdToCdfRate';
const changeEvent = 'stander-beauty-currency-change';

const readCurrency = (): Currency => {
  if (typeof window === 'undefined') return 'USD';
  return window.localStorage.getItem(storageKey) === 'CDF' ? 'CDF' : 'USD';
};

const subscribe = (listener: () => void) => {
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', listener);
  };
};

export const setCurrency = (currency: Currency) => {
  window.localStorage.setItem(storageKey, currency);
  window.dispatchEvent(new Event(changeEvent));
};

const readExchangeRate = (): number | null => {
  if (typeof window === 'undefined') return null;
  const storedRate = Number(window.localStorage.getItem(exchangeRateStorageKey));
  return Number.isFinite(storedRate) && storedRate > 0 ? storedRate : null;
};

export const setExchangeRate = (rate: number | null) => {
  if (rate === null) window.localStorage.removeItem(exchangeRateStorageKey);
  else window.localStorage.setItem(exchangeRateStorageKey, String(rate));
  window.dispatchEvent(new Event(changeEvent));
};

export const useCurrency = (): Currency => useSyncExternalStore<Currency>(subscribe, readCurrency, () => 'USD');
export const useExchangeRate = (): number | null => useSyncExternalStore<number | null>(subscribe, readExchangeRate, () => null);

const formatSingleCurrency = (value: number, currency: Currency) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'CDF' ? 0 : 2,
    maximumFractionDigits: currency === 'CDF' ? 0 : 2,
  }).format(value);

export const formatCurrencyExact = (value: number | string, currency: Currency) =>
  formatSingleCurrency(Number(value), currency);

export const formatCurrency = (value: number | string, currency: Currency) => {
  const amount = Number(value);
  const primary = formatSingleCurrency(amount, currency);
  const rate = readExchangeRate();
  if (!rate || !Number.isFinite(amount)) return primary;

  const alternateCurrency = currency === 'USD' ? 'CDF' : 'USD';
  const convertedAmount = currency === 'USD' ? amount * rate : amount / rate;
  return `${primary} · ${formatSingleCurrency(convertedAmount, alternateCurrency)}`;
};
