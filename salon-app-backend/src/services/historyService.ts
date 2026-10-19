import { Expense, ReportArchive, Sale, SaleItem, SalePayment, Staff, StaffPayout } from '../models';
import { currencies, isCurrency, roundMoney } from '../utils/money';
import {
  cashCountsOf, collectPeriod, dayKey, dayRange, figuresOf, isStillShown, journalOf, perCurrency, saleNames, userEmails, type PeriodData,
} from './operationsService';

/**
 * The daily history: every day with activity, and the full detail of one day. Operations are never
 * overwritten (cancellations are their own dated events), so a past day always reads the same,
 * whether or not it was closed; a closed day also shows the figures frozen at closing time.
 */

// Days of every operation in `data` (sales, payments, cancellations, expenses, payouts, cash movements).
const activeDays = (data: PeriodData) => {
  const days = new Set<string>();
  for (const sale of data.sales) if (isStillShown(sale)) days.add(dayKey(sale.saleDate));
  for (const entry of journalOf(data)) days.add(dayKey(entry.at));
  for (const expense of data.expenses) days.add(dayKey(expense.createdAt));
  return [...days].sort().reverse();
};

export const historyService = {
  // One row per day with activity between `from` and `to` (YYYY-MM-DD), newest first.
  days: async (from: string, to: string) => {
    const start = dayRange(from).start;
    const end = dayRange(to).end;
    const [data, archives] = await Promise.all([
      collectPeriod(start, end),
      ReportArchive.findAll({ where: { kind: 'daily' }, attributes: ['periodKey', 'closedAt'] }),
    ]);
    const journal = journalOf(data);
    return activeDays(data).map((day) => {
      const { start: dayStart, end: dayEnd } = dayRange(day);
      const inDay = (date: Date) => date >= dayStart && date <= dayEnd;
      const { byCurrency, unclassifiedSales } = figuresOf(data, inDay);
      const movements = perCurrency(() => ({ cashIn: 0, cashOut: 0, debtsCreated: 0, debtsPaid: 0 }));
      for (const entry of journal) {
        if (!inDay(entry.at)) continue;
        movements[entry.currency][entry.direction === 'in' ? 'cashIn' : 'cashOut'] += entry.amount;
        if (entry.type === 'debt_payment') movements[entry.currency].debtsPaid += entry.amount;
      }
      for (const sale of data.sales) {
        if (!inDay(sale.saleDate) || sale.status !== 'completed' || !isCurrency(sale.currency)) continue;
        movements[sale.currency].debtsCreated += Number(sale.totalAmount) - (sale.get('payments') as SalePayment[])
          .filter((payment) => payment.kind === 'sale').reduce((sum, payment) => sum + Number(payment.amount), 0);
      }
      for (const currency of currencies) {
        for (const key of ['cashIn', 'cashOut', 'debtsCreated', 'debtsPaid'] as const) movements[currency][key] = roundMoney(movements[currency][key], currency);
      }
      const archive = archives.find((entry) => entry.periodKey === day);
      return {
        day,
        closedAt: archive?.closedAt ?? null,
        unclassifiedSales,
        byCurrency: Object.fromEntries(currencies.map((currency) => [currency, { ...byCurrency[currency], ...movements[currency] }])),
      };
    });
  },

  // Every operation of one day, with the people involved and the accounts that recorded them.
  day: async (day: string) => {
    const { start, end } = dayRange(day);
    const [data, archive, counts] = await Promise.all([
      collectPeriod(start, end),
      ReportArchive.findOne({ where: { kind: 'daily', periodKey: day } }),
      cashCountsOf(day),
    ]);
    const journal = journalOf(data);
    const { byCurrency, unclassifiedSales } = figuresOf(data);

    // Sales made that day, plus sales cancelled or paid that day although made earlier.
    const otherSaleIds = [
      ...data.cancelledSales.map((sale) => sale.id),
      ...data.payments.map((payment) => payment.saleId),
    ].filter((id) => !data.sales.some((sale) => sale.id === id));
    const otherSales = otherSaleIds.length
      ? await Sale.findAll({ where: { id: [...new Set(otherSaleIds)] }, include: [{ association: 'items' }, { association: 'payments' }] })
      : [];
    const allSales = [...data.sales, ...otherSales];
    const names = await saleNames(allSales);
    const emails = await userEmails([
      ...allSales.flatMap((sale) => [sale.createdByUserId, sale.cancelledByUserId]),
      ...journal.map((entry) => entry.userId),
      ...data.expenses.flatMap((expense) => [expense.createdByUserId, expense.cancelledByUserId]),
      ...counts.map((count) => count.userId),
    ]);
    const email = (id: string | null | undefined) => (id ? emails.get(id) ?? null : null);

    const describeSale = (sale: Sale) => ({
      id: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, status: sale.status,
      currency: sale.currency, totalAmount: Number(sale.totalAmount), amountPaid: Number(sale.amountPaid),
      remainingAmount: Number(sale.remainingAmount), paymentMethod: sale.paymentMethod,
      client: names.client(sale) ?? 'Client de passage', staffName: names.staff(sale),
      createdBy: email(sale.createdByUserId),
      cancelledAt: sale.cancelledAt, cancelledBy: email(sale.cancelledByUserId), cancelReason: sale.cancelReason,
      items: (sale.get('items') as SaleItem[]).map((item) => ({
        type: item.type, name: item.itemName ?? (item.type === 'service' ? 'Prestation' : 'Produit'), audience: item.audience,
        quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), subtotal: Number(item.subtotal),
      })),
    });

    const payouts = await StaffPayout.findAll({
      where: { id: data.payouts.map((payout) => payout.id) },
      include: [{ model: Staff, attributes: ['id', 'name'] }],
      order: [['createdAt', 'ASC']],
    });
    const expenses = [...new Map([...data.expenses, ...data.cancelledExpenses].map((expense) => [expense.id, expense])).values()];

    return {
      day,
      closedAt: archive?.closedAt ?? null,
      archive: archive?.breakdown ?? null,
      byCurrency,
      unclassifiedSales,
      // Cancelled sales are listed for 7 days after their cancellation.
      sales: data.sales.filter(isStillShown).map(describeSale),
      services: data.sales.filter((sale) => sale.status === 'completed').flatMap((sale) => (sale.get('items') as SaleItem[])
        .filter((item) => item.type === 'service')
        .map((item) => ({
          saleId: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, name: item.itemName ?? 'Prestation',
          audience: item.audience, quantity: Number(item.quantity), amount: Number(item.subtotal), currency: sale.currency,
          staffName: names.staff(sale),
        }))),
      products: data.sales.filter((sale) => sale.status === 'completed').flatMap((sale) => (sale.get('items') as SaleItem[])
        .filter((item) => item.type === 'product')
        .map((item) => ({
          saleId: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, name: item.itemName ?? 'Produit',
          quantity: Number(item.quantity), amount: Number(item.subtotal), currency: sale.currency,
        }))),
      cancellations: data.cancelledSales.filter(isStillShown).map((sale) => describeSale(otherSales.find((entry) => entry.id === sale.id) ?? data.sales.find((entry) => entry.id === sale.id) ?? sale)),
      debts: {
        created: data.sales.filter((sale) => sale.status === 'completed' && Number(sale.remainingAmount) > 0).map(describeSale),
        payments: data.payments.filter((payment) => payment.kind === 'debt').map((payment) => {
          const sale = allSales.find((entry) => entry.id === payment.saleId);
          return {
            id: payment.id, date: payment.createdAt, amount: Number(payment.amount), currency: payment.currency,
            paymentMethod: payment.paymentMethod, receiptNumber: sale ? Number(sale.receiptNumber) : null,
            client: sale ? names.client(sale) ?? 'Client de passage' : null, remainingAmount: sale ? Number(sale.remainingAmount) : null,
            recordedBy: email(payment.userId),
          };
        }),
      },
      expenses: expenses.map((expense: Expense) => ({
        id: expense.id, date: expense.createdAt, description: expense.description, category: expense.category,
        amount: Number(expense.amount), currency: expense.currency, paymentMethod: expense.paymentMethod,
        createdBy: email(expense.createdByUserId), cancelledAt: expense.cancelledAt, cancelledBy: email(expense.cancelledByUserId),
        cancelReason: expense.cancelReason,
      })),
      payouts: payouts.map((payout) => ({
        id: payout.id, date: payout.createdAt, staffId: payout.staffId, staffName: (payout.get('Staff') as Staff | undefined)?.name ?? null,
        kind: payout.kind, amount: Number(payout.amount), currency: payout.currency, paymentMethod: payout.paymentMethod,
        note: payout.note, paidBy: email(payout.paidByUserId),
      })),
      journal: journal.map((entry) => ({ ...entry, userEmail: email(entry.userId) })),
      cashCounts: counts.map((count) => ({
        id: count.id, currency: count.currency, expectedAmount: Number(count.expectedAmount), countedAmount: Number(count.countedAmount),
        difference: roundMoney(Number(count.countedAmount) - Number(count.expectedAmount), count.currency), note: count.note,
        countedBy: email(count.userId), date: count.createdAt,
      })),
    };
  },
};
