import { Op } from 'sequelize';
import {
  CashAdjustment, CashCount, Client, Commission, Expense, Sale, SaleItem, SalePayment, Staff, StaffPayout, User,
} from '../models';
import { currencies, isCurrency, roundMoney, type Currency } from '../utils/money';

/**
 * Every money operation of a period, read once and summarised per currency. Reports, the daily
 * history, the cash journal and the dashboard all derive from it, so their figures always agree.
 * Nothing here converts between currencies: USD and CDF amounts are kept and totalled apart.
 */

export type JournalType = 'sale_payment' | 'debt_payment' | 'refund' | 'expense' | 'expense_cancel' | 'payout' | 'adjustment';
export type JournalEntry = {
  id: string;
  at: Date;
  type: JournalType;
  direction: 'in' | 'out';
  amount: number;
  currency: Currency;
  paymentMethod: string;
  label: string;
  saleId?: string;
  receiptNumber?: number;
  userId: string | null;
  userEmail?: string | null;
};

export type PeriodFigures = {
  // Turnover of the sales made in the period (cancelled sales excluded).
  totalSales: number;
  serviceRevenue: number;
  productRevenue: number;
  transactionCount: number;
  // Money actually received in the period (sales and debt payments), and given back on cancellations.
  amountReceived: number;
  refunds: number;
  // What clients still owe on the period's sales.
  outstandingAmount: number;
  totalExpenses: number;
  expenseCount: number;
  // Commissions earned on the period's sales; payouts (advances and payments) made in the period.
  totalCommissions: number;
  payroll: number;
  fixedSalaryPayroll: number;
  adjustmentsIn: number;
  adjustmentsOut: number;
  // Purchase cost of the products sold; null when an older sale line has no recorded cost.
  costOfGoods: number | null;
  // turnover − cost of goods − commissions − expenses − fixed salaries paid; null when not computable.
  estimatedProfit: number | null;
  // Cash result of the period: received − refunds − expenses − payroll ± adjustments.
  netBalance: number;
};

const emptyFigures = (): PeriodFigures => ({
  totalSales: 0, serviceRevenue: 0, productRevenue: 0, transactionCount: 0, amountReceived: 0, refunds: 0,
  outstandingAmount: 0, totalExpenses: 0, expenseCount: 0, totalCommissions: 0, payroll: 0, fixedSalaryPayroll: 0,
  adjustmentsIn: 0, adjustmentsOut: 0, costOfGoods: 0, estimatedProfit: 0, netBalance: 0,
});

export const perCurrency = <T>(make: () => T) =>
  Object.fromEntries(currencies.map((currency) => [currency, make()])) as Record<Currency, T>;

// Local calendar day (YYYY-MM-DD), the unit of the daily history and of the closures.
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const dayRange = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year, month - 1, date);
  const end = new Date(year, month - 1, date + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start, end };
};

const between = (start: Date, end: Date) => ({ [Op.between]: [start, end] });

// A cancelled sale stays listed (history, sales page) for this long after its cancellation, then is
// no longer shown. It is kept in the database: stock movements and commissions still refer to it.
export const cancelledSaleVisibleDays = 7;
export const cancelledVisibleSince = () => new Date(Date.now() - cancelledSaleVisibleDays * 86_400_000);
export const isStillShown = (sale: Pick<Sale, 'status' | 'cancelledAt'>) =>
  sale.status !== 'refunded' || !sale.cancelledAt || sale.cancelledAt >= cancelledVisibleSince();
const itemsOf = (sale: Sale) => (sale.get('items') as SaleItem[] | undefined) ?? [];

export type PeriodData = Awaited<ReturnType<typeof collectPeriod>>;

// Reads the rows of every operation that happened between start and end.
export const collectPeriod = async (start: Date, end: Date) => {
  const [sales, payments, cancelledSales, expenses, cancelledExpenses, payouts, adjustments] = await Promise.all([
    Sale.findAll({ where: { saleDate: between(start, end) }, include: [{ association: 'items' }, { association: 'payments' }], order: [['saleDate', 'ASC']] }),
    SalePayment.findAll({ where: { createdAt: between(start, end) }, include: [{ model: Sale, attributes: ['id', 'receiptNumber', 'clientId', 'clientName', 'status'] }], order: [['createdAt', 'ASC']] }),
    Sale.findAll({ where: { cancelledAt: between(start, end) }, include: [{ association: 'payments' }, { association: 'items' }] }),
    Expense.findAll({ where: { createdAt: between(start, end) }, order: [['createdAt', 'ASC']] }),
    Expense.findAll({ where: { cancelledAt: between(start, end) } }),
    StaffPayout.findAll({ where: { createdAt: between(start, end) }, include: [{ model: Staff, attributes: ['id', 'name', 'payType'] }], order: [['createdAt', 'ASC']] }),
    CashAdjustment.findAll({ where: { createdAt: between(start, end) }, order: [['createdAt', 'ASC']] }),
  ]);
  const itemIds = sales.flatMap((sale) => itemsOf(sale).map((item) => item.id));
  const commissions = itemIds.length
    ? await Commission.findAll({ where: { saleItemId: itemIds, cancelledAt: null } })
    : [];
  return { start, end, sales, payments, cancelledSales, expenses, cancelledExpenses, payouts, adjustments, commissions };
};

// The cash journal: every money movement, in chronological order. A cancelled sale counts as if it
// had never happened: neither what it brought in nor what was given back appears (the cancellation
// itself is listed with the day's cancellations).
export const journalOf = (data: PeriodData): JournalEntry[] => {
  const entries: JournalEntry[] = [];
  for (const payment of data.payments) {
    if (!isCurrency(payment.currency)) continue;
    const sale = payment.get('Sale') as Sale | undefined;
    if (sale?.status === 'refunded') continue;
    entries.push({
      id: payment.id, at: payment.createdAt, type: payment.kind === 'debt' ? 'debt_payment' : 'sale_payment', direction: 'in',
      amount: Number(payment.amount), currency: payment.currency, paymentMethod: payment.paymentMethod,
      label: payment.kind === 'debt' ? 'Règlement de dette' : 'Vente', saleId: payment.saleId,
      receiptNumber: sale ? Number(sale.receiptNumber) : undefined, userId: payment.userId,
    });
  }
  for (const expense of data.expenses) {
    if (!isCurrency(expense.currency)) continue;
    entries.push({
      id: expense.id, at: expense.createdAt, type: 'expense', direction: 'out', amount: Number(expense.amount), currency: expense.currency,
      paymentMethod: expense.paymentMethod, label: `Dépense : ${expense.description}`, userId: expense.createdByUserId,
    });
  }
  for (const expense of data.cancelledExpenses) {
    if (!isCurrency(expense.currency)) continue;
    entries.push({
      id: `cancel-${expense.id}`, at: expense.cancelledAt!, type: 'expense_cancel', direction: 'in', amount: Number(expense.amount),
      currency: expense.currency, paymentMethod: expense.paymentMethod,
      label: `Dépense annulée : ${expense.description}${expense.cancelReason ? ` (${expense.cancelReason})` : ''}`, userId: expense.cancelledByUserId,
    });
  }
  for (const payout of data.payouts) {
    if (!isCurrency(payout.currency)) continue;
    const staff = payout.get('Staff') as Staff | undefined;
    entries.push({
      id: payout.id, at: payout.createdAt, type: 'payout', direction: 'out', amount: Number(payout.amount), currency: payout.currency,
      paymentMethod: payout.paymentMethod, label: `${payout.kind === 'advance' ? 'Avance' : 'Rémunération'} : ${staff?.name ?? 'membre de l’équipe'}`,
      userId: payout.paidByUserId,
    });
  }
  for (const adjustment of data.adjustments) {
    if (!isCurrency(adjustment.currency)) continue;
    entries.push({
      id: adjustment.id, at: adjustment.createdAt, type: 'adjustment', direction: adjustment.direction, amount: Number(adjustment.amount),
      currency: adjustment.currency, paymentMethod: adjustment.paymentMethod,
      label: `${adjustment.direction === 'in' ? 'Entrée' : 'Sortie'} de caisse : ${adjustment.reason}`, userId: adjustment.userId,
    });
  }
  return entries.sort((left, right) => left.at.getTime() - right.at.getTime());
};

// Figures per currency of the operations in `data` that satisfy `keep` (e.g. one day of a longer period).
export const figuresOf = (data: PeriodData, keep: (date: Date) => boolean = () => true) => {
  const byCurrency = perCurrency(emptyFigures);
  const costUnknown = perCurrency(() => false);
  let unclassifiedSales = 0;
  const completedItemIds = new Set<string>();
  const journal = journalOf(data);

  for (const sale of data.sales) {
    if (!keep(sale.saleDate) || sale.status !== 'completed') continue;
    if (!isCurrency(sale.currency)) {
      unclassifiedSales += 1;
      continue;
    }
    const figures = byCurrency[sale.currency];
    figures.transactionCount += 1;
    figures.outstandingAmount += Number(sale.remainingAmount);
    for (const item of itemsOf(sale)) {
      completedItemIds.add(item.id);
      const amount = Number(item.subtotal);
      figures.totalSales += amount;
      if (item.type === 'service') {
        figures.serviceRevenue += amount;
      } else {
        figures.productRevenue += amount;
        if (item.unitCost == null) costUnknown[sale.currency] = true;
        else figures.costOfGoods! += Number(item.unitCost) * Number(item.quantity);
      }
    }
  }
  for (const commission of data.commissions) {
    if (completedItemIds.has(commission.saleItemId) && isCurrency(commission.currency)) {
      byCurrency[commission.currency].totalCommissions += Number(commission.commissionAmount);
    }
  }
  for (const expense of data.expenses) {
    if (!keep(expense.createdAt) || expense.cancelledAt || !isCurrency(expense.currency)) continue;
    byCurrency[expense.currency].totalExpenses += Number(expense.amount);
    byCurrency[expense.currency].expenseCount += 1;
  }
  for (const entry of journal) {
    if (!keep(entry.at)) continue;
    const figures = byCurrency[entry.currency];
    if (entry.type === 'sale_payment' || entry.type === 'debt_payment') figures.amountReceived += entry.amount;
    else if (entry.type === 'refund') figures.refunds += entry.amount;
    else if (entry.type === 'adjustment') figures[entry.direction === 'in' ? 'adjustmentsIn' : 'adjustmentsOut'] += entry.amount;
    else if (entry.type === 'payout') figures.payroll += entry.amount;
  }
  for (const payout of data.payouts) {
    const staff = payout.get('Staff') as Staff | undefined;
    if (keep(payout.createdAt) && staff?.payType === 'fixed' && isCurrency(payout.currency)) {
      byCurrency[payout.currency].fixedSalaryPayroll += Number(payout.amount);
    }
  }

  for (const currency of currencies) {
    const figures = byCurrency[currency];
    for (const key of ['totalSales', 'serviceRevenue', 'productRevenue', 'amountReceived', 'refunds', 'outstandingAmount', 'totalExpenses',
      'totalCommissions', 'payroll', 'fixedSalaryPayroll', 'adjustmentsIn', 'adjustmentsOut'] as const) {
      figures[key] = roundMoney(figures[key], currency);
    }
    // Expenses cancelled in the period come back into the cash result (their entry was counted when made).
    const expenseCancellations = journal
      .filter((entry) => entry.type === 'expense_cancel' && entry.currency === currency && keep(entry.at))
      .reduce((sum, entry) => sum + entry.amount, 0);
    const expensesPaid = data.expenses
      .filter((expense) => keep(expense.createdAt) && expense.currency === currency)
      .reduce((sum, expense) => sum + Number(expense.amount), 0);
    figures.netBalance = roundMoney(figures.amountReceived - figures.refunds - expensesPaid + expenseCancellations - figures.payroll
      + figures.adjustmentsIn - figures.adjustmentsOut, currency);
    figures.costOfGoods = costUnknown[currency] ? null : roundMoney(figures.costOfGoods!, currency);
    figures.estimatedProfit = figures.costOfGoods === null ? null
      : roundMoney(figures.totalSales - figures.costOfGoods - figures.totalCommissions - figures.totalExpenses - figures.fixedSalaryPayroll, currency);
  }
  return { byCurrency, unclassifiedSales };
};

// Email of the accounts that performed the operations, for the history ("who did what").
export const userEmails = async (ids: (string | null | undefined)[]) => {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, string>();
  const users = await User.findAll({ where: { id: unique }, attributes: ['id', 'email'] });
  return new Map(users.map((user) => [user.id, user.email]));
};

// Names of the clients and staff referenced by sales.
export const saleNames = async (sales: Sale[]) => {
  const clientIds = [...new Set(sales.map((sale) => sale.clientId).filter((id): id is string => Boolean(id)))];
  const staffIds = [...new Set(sales.map((sale) => sale.staffId).filter((id): id is string => Boolean(id)))];
  const [clients, staff] = await Promise.all([
    clientIds.length ? Client.findAll({ where: { id: clientIds }, attributes: ['id', 'name'] }) : [],
    staffIds.length ? Staff.findAll({ where: { id: staffIds }, attributes: ['id', 'name'] }) : [],
  ]);
  return {
    client: (sale: Sale) => sale.clientName ?? clients.find((client) => client.id === sale.clientId)?.name ?? null,
    staff: (sale: Sale) => staff.find((member) => member.id === sale.staffId)?.name ?? null,
  };
};

export const cashCountsOf = (day: string) => CashCount.findAll({ where: { day }, order: [['createdAt', 'ASC']] });
