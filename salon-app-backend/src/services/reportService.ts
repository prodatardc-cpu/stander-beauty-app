import { Op } from 'sequelize';
import { CashCount, Commission, Sale, SaleItem, SalePayment } from '../models';
import { currencies, isCurrency, roundMoney, type Currency } from '../utils/money';
import {
  collectPeriod, dayKey, figuresOf, journalOf, perCurrency, saleNames, userEmails,
} from './operationsService';
import { summarizePay } from './payrollService';

// Every amount is reported per currency: USD and CDF figures are never added together.
export type { PeriodFigures } from './operationsService';

type SalesFilters = { staffId?: string; type?: 'service' | 'product'; currency?: Currency };

export const reportService = {
  // Rapport par période
  getReportByPeriod: async (startDate: Date, endDate: Date) => {
    const data = await collectPeriod(startDate, endDate);
    const { byCurrency, unclassifiedSales } = figuresOf(data);
    return { period: { start: startDate, end: endDate }, byCurrency, unclassifiedSales };
  },

  // A. Sales: one row per line sold (services and products), with the member who performed it.
  getSalesReport: async (startDate: Date, endDate: Date, filters: SalesFilters) => {
    const sales = await Sale.findAll({
      where: {
        status: 'completed',
        saleDate: { [Op.between]: [startDate, endDate] },
        ...(filters.staffId && { staffId: filters.staffId }),
        ...(filters.currency && { currency: filters.currency }),
      },
      include: [{ association: 'items', ...(filters.type && { where: { type: filters.type } }) }],
      order: [['saleDate', 'ASC']],
    });
    const names = await saleNames(sales);
    const rows = sales.flatMap((sale) => (sale.get('items') as SaleItem[]).map((item) => ({
      saleId: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, type: item.type,
      name: item.itemName ?? (item.type === 'service' ? 'Prestation' : 'Produit'), audience: item.audience,
      quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), amount: Number(item.subtotal),
      currency: sale.currency, staffName: names.staff(sale), client: names.client(sale),
    })));
    const totals = perCurrency(() => ({ services: 0, products: 0, servicesQuantity: 0, productsQuantity: 0, total: 0 }));
    for (const row of rows) {
      if (!isCurrency(row.currency)) continue;
      const total = totals[row.currency];
      total[row.type === 'service' ? 'services' : 'products'] += row.amount;
      total[row.type === 'service' ? 'servicesQuantity' : 'productsQuantity'] += row.quantity;
      total.total += row.amount;
    }
    for (const currency of currencies) {
      for (const key of ['services', 'products', 'total'] as const) totals[currency][key] = roundMoney(totals[currency][key], currency);
    }
    return { period: { start: startDate, end: endDate }, rows, totals };
  },

  // B. Cash: every money movement, totals per currency, and the drawer counts of the period.
  getCashReport: async (startDate: Date, endDate: Date) => {
    const data = await collectPeriod(startDate, endDate);
    const journal = journalOf(data);
    const emails = await userEmails(journal.map((entry) => entry.userId));
    const totals = perCurrency(() => ({ in: 0, out: 0, balance: 0, cashIn: 0, cashOut: 0, cashBalance: 0 }));
    for (const entry of journal) {
      const total = totals[entry.currency];
      total[entry.direction] += entry.amount;
      if (entry.paymentMethod === 'cash') total[entry.direction === 'in' ? 'cashIn' : 'cashOut'] += entry.amount;
    }
    for (const currency of currencies) {
      const total = totals[currency];
      for (const key of ['in', 'out', 'cashIn', 'cashOut'] as const) total[key] = roundMoney(total[key], currency);
      total.balance = roundMoney(total.in - total.out, currency);
      total.cashBalance = roundMoney(total.cashIn - total.cashOut, currency);
    }
    const counts = await CashCount.findAll({
      where: { day: { [Op.between]: [dayKey(startDate), dayKey(endDate)] } },
      order: [['day', 'ASC'], ['createdAt', 'ASC']],
    });
    return {
      period: { start: startDate, end: endDate },
      entries: journal.map((entry) => ({ ...entry, userEmail: entry.userId ? emails.get(entry.userId) ?? null : null })),
      totals,
      counts,
    };
  },

  // C. Debts: sales not fully paid (open) and those settled after the sale (settled).
  getDebtsReport: async (status: 'open' | 'settled' | 'all', currency?: Currency) => {
    const debtSaleIds = (await SalePayment.findAll({ where: { kind: 'debt' }, attributes: ['saleId'] })).map((payment) => payment.saleId);
    const sales = await Sale.findAll({
      where: {
        status: 'completed',
        ...(currency && { currency }),
        ...(status === 'open' ? { remainingAmount: { [Op.gt]: 0 } }
          : status === 'settled' ? { remainingAmount: 0, id: debtSaleIds }
          : { [Op.or]: [{ remainingAmount: { [Op.gt]: 0 } }, { id: debtSaleIds }] }),
      },
      include: [{ association: 'payments' }],
      order: [['saleDate', 'DESC']],
    });
    const names = await saleNames(sales);
    const rows = sales.map((sale) => {
      const payments = (sale.get('payments') as SalePayment[]);
      const lastPayment = payments.reduce<Date | null>((latest, payment) => (!latest || payment.createdAt > latest ? payment.createdAt : latest), null);
      return {
        saleId: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, client: names.client(sale) ?? 'Client de passage',
        clientId: sale.clientId, currency: sale.currency, initialAmount: Number(sale.totalAmount), paidAmount: Number(sale.amountPaid),
        remainingAmount: Number(sale.remainingAmount), lastPaymentAt: lastPayment, status: Number(sale.remainingAmount) > 0 ? 'open' : 'settled',
      };
    });
    const totals = perCurrency(() => ({ initialAmount: 0, paidAmount: 0, remainingAmount: 0, count: 0 }));
    for (const row of rows) {
      if (!isCurrency(row.currency)) continue;
      const total = totals[row.currency];
      total.initialAmount += row.initialAmount;
      total.paidAmount += row.paidAmount;
      total.remainingAmount += row.remainingAmount;
      total.count += 1;
    }
    for (const value of currencies) {
      for (const key of ['initialAmount', 'paidAmount', 'remainingAmount'] as const) totals[value][key] = roundMoney(totals[value][key], value);
    }
    return { rows, totals };
  },

  // D. Team: per member and currency, what they did and earned in the period, and what is still due.
  getTeamReport: async (startDate: Date, endDate: Date, staffId?: string) => {
    const pay = await summarizePay(staffId ? [staffId] : undefined);
    const ids = pay.map((member) => member.staffId);
    if (!ids.length) return { period: { start: startDate, end: endDate }, members: [] };
    const [sales, commissions, payouts] = await Promise.all([
      Sale.findAll({
        where: { staffId: ids, status: 'completed', saleDate: { [Op.between]: [startDate, endDate] } },
        attributes: ['staffId', 'currency'],
        include: [{ association: 'items', where: { type: 'service' }, attributes: ['quantity', 'subtotal'] }],
      }),
      Commission.findAll({ where: { staffId: ids, cancelledAt: null, date: { [Op.between]: [startDate, endDate] } } }),
      (await collectPeriod(startDate, endDate)).payouts,
    ]);
    const members = pay.map((member) => {
      const byCurrency = perCurrency(() => ({ servicesCount: 0, revenue: 0, earned: 0, advances: 0, payments: 0, remaining: 0 }));
      for (const sale of sales) {
        if (sale.staffId !== member.staffId || !isCurrency(sale.currency)) continue;
        for (const item of (sale.get('items') as SaleItem[])) {
          byCurrency[sale.currency].servicesCount += Number(item.quantity);
          byCurrency[sale.currency].revenue += Number(item.subtotal);
        }
      }
      if (member.payType !== 'fixed') {
        for (const commission of commissions) {
          if (commission.staffId === member.staffId && isCurrency(commission.currency)) byCurrency[commission.currency].earned += Number(commission.commissionAmount);
        }
      }
      for (const payout of payouts) {
        if (payout.staffId !== member.staffId || !isCurrency(payout.currency)) continue;
        byCurrency[payout.currency][payout.kind === 'advance' ? 'advances' : 'payments'] += Number(payout.amount);
      }
      for (const currency of currencies) {
        const figures = byCurrency[currency];
        if (member.payType === 'fixed') figures.earned = member.byCurrency[currency].period.earned;
        for (const key of ['revenue', 'earned', 'advances', 'payments'] as const) figures[key] = roundMoney(figures[key], currency);
        figures.remaining = member.byCurrency[currency].remaining;
      }
      return {
        staffId: member.staffId, name: member.name, position: member.position, payType: member.payType,
        commissionRate: member.commissionRate, monthlySalary: member.monthlySalary, archivedAt: member.archivedAt, byCurrency,
      };
    });
    return { period: { start: startDate, end: endDate }, members };
  },

  // Rapport par travailleur
  getReportByStaff: async (staffId: string, startDate: Date, endDate: Date) => {
    const report = await reportService.getTeamReport(startDate, endDate, staffId);
    return { period: report.period, member: report.members[0] ?? null };
  },

  // Rapport par service
  getReportByService: async (serviceId: string, startDate: Date, endDate: Date) => {
    const saleItems = await SaleItem.findAll({
      where: { itemId: serviceId, type: 'service' },
      include: [{ association: 'Sale', where: { status: 'completed', saleDate: { [Op.between]: [startDate, endDate] } } }],
    });
    const byCurrency = perCurrency(() => ({ totalRevenue: 0, totalCommissions: 0, saleCount: 0 }));
    for (const item of saleItems) {
      const currency = (item.get('Sale') as Sale).currency;
      if (!isCurrency(currency)) continue;
      byCurrency[currency].totalRevenue += Number(item.subtotal);
      byCurrency[currency].saleCount += 1;
    }
    const commissions = saleItems.length
      ? await Commission.findAll({ where: { saleItemId: saleItems.map((item) => item.id), cancelledAt: null } })
      : [];
    for (const commission of commissions) {
      if (isCurrency(commission.currency)) byCurrency[commission.currency].totalCommissions += Number(commission.commissionAmount);
    }
    for (const currency of currencies) {
      byCurrency[currency].totalRevenue = roundMoney(byCurrency[currency].totalRevenue, currency);
      byCurrency[currency].totalCommissions = roundMoney(byCurrency[currency].totalCommissions, currency);
    }
    return { serviceId, period: { start: startDate, end: endDate }, byCurrency };
  },

  // Rapport par produit
  getReportByProduct: async (productId: string, startDate: Date, endDate: Date) => {
    const saleItems = await SaleItem.findAll({
      where: { itemId: productId, type: 'product' },
      include: [{ association: 'Sale', where: { status: 'completed', saleDate: { [Op.between]: [startDate, endDate] } } }],
    });
    const totalQuantity = saleItems.reduce((sum, item) => sum + item.quantity, 0);
    const byCurrency = perCurrency(() => ({ totalRevenue: 0, saleCount: 0 }));
    for (const item of saleItems) {
      const currency = (item.get('Sale') as Sale).currency;
      if (!isCurrency(currency)) continue;
      byCurrency[currency].totalRevenue += Number(item.subtotal);
      byCurrency[currency].saleCount += 1;
    }
    for (const currency of currencies) byCurrency[currency].totalRevenue = roundMoney(byCurrency[currency].totalRevenue, currency);
    return { productId, period: { start: startDate, end: endDate }, totalQuantity, byCurrency };
  },

  // Dashboard: today's figures, what clients still owe and what is due to the team, per currency.
  getDashboardStats: async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    const data = await collectPeriod(start, end);
    const today = figuresOf(data);
    let servicesToday = 0;
    let productsSoldToday = 0;
    for (const sale of data.sales) {
      if (sale.status !== 'completed') continue;
      for (const item of (sale.get('items') as SaleItem[])) {
        if (item.type === 'service') servicesToday += Number(item.quantity);
        else productsSoldToday += Number(item.quantity);
      }
    }
    const [openDebts, pay] = await Promise.all([
      Sale.findAll({ where: { status: 'completed', remainingAmount: { [Op.gt]: 0 } }, attributes: ['currency', 'remainingAmount'] }),
      summarizePay(),
    ]);
    const debts = perCurrency(() => ({ amount: 0, count: 0 }));
    for (const sale of openDebts) {
      if (!isCurrency(sale.currency)) continue;
      debts[sale.currency].amount += Number(sale.remainingAmount);
      debts[sale.currency].count += 1;
    }
    const payrollDue = perCurrency(() => 0);
    for (const member of pay) {
      if (member.archivedAt) continue;
      for (const currency of currencies) payrollDue[currency] += Math.max(0, member.byCurrency[currency].remaining);
    }
    for (const currency of currencies) {
      debts[currency].amount = roundMoney(debts[currency].amount, currency);
      payrollDue[currency] = roundMoney(payrollDue[currency], currency);
    }
    return { today: today.byCurrency, unclassifiedSalesToday: today.unclassifiedSales, servicesToday, productsSoldToday, debts, payrollDue };
  },
};
