import type { Sale } from '../types';

export const formatDate = (value?: string | Date | null) =>
  value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)) : '—';

export const formatDateTime = (value?: string | Date | null) =>
  value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export const formatTime = (value: string | Date) =>
  new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(new Date(value));

export const paymentMethodLabels: Record<Sale['paymentMethod'], string> = {
  cash: 'Espèces',
  momo: 'Mobile Money',
  card: 'Carte',
  transfer: 'Virement',
  other: 'Autre',
};

export const roleLabels = { admin: 'Administrateur', cashier: 'Caisse', staff: 'Équipe' } as const;

// YYYY-MM-DD in the browser's local time zone (what <input type="date"> uses).
export const toLocalDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Converts a local YYYY-MM-DD into the ISO instant of the start (or end) of that local day.
export const localDayBoundary = (value: string, edge: 'start' | 'end') => {
  const [year, month, day] = value.split('-').map(Number);
  const date = edge === 'start' ? new Date(year, month - 1, day, 0, 0, 0, 0) : new Date(year, month - 1, day, 23, 59, 59, 999);
  return date.toISOString();
};

export const isSameLocalDay = (value: string | Date, reference = new Date()) =>
  toLocalDateInput(new Date(value)) === toLocalDateInput(reference);

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

// Receipt numbers are printed on six digits: N° 000042.
export const formatReceiptNumber = (value: number | string | undefined) => `N° ${String(value ?? '').padStart(6, '0')}`;

// "Mois du 1 oct. 2026 au 31 oct. 2026": the remuneration period of a team member.
export const periodLabel = ({ period }: { period: { kind: 'weekly' | 'monthly'; start: string; end: string } }) =>
  `${period.kind === 'weekly' ? 'Semaine' : 'Mois'} du ${formatDate(period.start)} au ${formatDate(period.end)}`;
