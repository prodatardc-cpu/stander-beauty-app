import type { Currency } from './currency';

// The transaction being prepared at the till, kept for the browser tab (sessionStorage) so that
// going back, visiting another page or adding a product from the shop never loses it.
// customPrice: a service price set by the cashier, valid in customCurrency (the sale currency it was typed in).
export type TillLine = {
  type: 'product' | 'service'; itemId: string; name: string; basePrice: number; quantity: number; audience?: 'women' | 'men';
  customPrice?: number; customCurrency?: Currency;
};
export type TillDraft = {
  cart: TillLine[];
  // Base currency the cart prices were read in: a different one means the cart is stale.
  baseCurrency?: Currency;
  saleCurrency?: Currency;
  clientId?: string;
  guestClientName?: string;
  staffId?: string;
};

const storageKey = 'standerBeauty.till';

export const lineKey = (line: Pick<TillLine, 'type' | 'itemId' | 'audience'>) => `${line.type}:${line.itemId}:${line.audience ?? ''}`;

export const readTill = (): TillDraft => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as TillDraft | null;
    return parsed && Array.isArray(parsed.cart) ? parsed : { cart: [] };
  } catch {
    return { cart: [] };
  }
};

export const writeTill = (draft: TillDraft) => {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the cart simply lives in the page.
  }
};

// Adds an item to the current transaction (used by the shop's "Ajouter à la caisse").
export const addToTill = (line: TillLine, baseCurrency: Currency) => {
  const draft = readTill();
  const cart = draft.baseCurrency && draft.baseCurrency !== baseCurrency ? [] : draft.cart;
  const key = lineKey(line);
  const existing = cart.find((entry) => lineKey(entry) === key);
  writeTill({
    ...draft,
    baseCurrency,
    cart: existing
      ? cart.map((entry) => (lineKey(entry) === key ? { ...entry, quantity: entry.quantity + line.quantity } : entry))
      : [...cart, line],
  });
};
