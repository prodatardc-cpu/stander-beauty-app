import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../config/database';
import { Commission, Sale, SaleItem, Staff, StaffPayout } from '../models';
import { currencies, isCurrency, roundMoney, type Currency } from '../utils/money';
import { isStillShown, perCurrency } from './operationsService';
import { settingsService } from './settingsService';

export class PayrollError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PayPeriod = 'weekly' | 'monthly';

// The remuneration period containing `reference`: Monday to Sunday, or the calendar month.
export const periodRange = (kind: PayPeriod, reference = new Date()) => {
  const start = kind === 'weekly'
    ? new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - ((reference.getDay() + 6) % 7))
    : new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = kind === 'weekly'
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { kind, start, end };
};

type Amounts = { eligibleRevenue: number; servicesCount: number; earned: number; advances: number; payments: number };
const emptyAmounts = (): Amounts => ({ eligibleRevenue: 0, servicesCount: 0, earned: 0, advances: 0, payments: 0 });

export type CurrencyPay = {
  period: Amounts;
  total: Amounts;
  // Still due from earlier periods (negative: paid in advance).
  carriedOver: number;
  // What remains to pay overall; 0 once everything earned has been paid.
  remaining: number;
};

export type StaffPay = {
  staffId: string;
  name: string;
  position: string;
  photoUrl: string | null;
  status: string;
  archivedAt: Date | null;
  payType: 'commission' | 'fixed';
  commissionRate: number;
  monthlySalary: number;
  period: { kind: PayPeriod; start: Date; end: Date };
  byCurrency: Record<Currency, CurrencyPay>;
};

const round = (amounts: Amounts, currency: Currency) => {
  for (const key of ['eligibleRevenue', 'earned', 'advances', 'payments'] as const) amounts[key] = roundMoney(amounts[key], currency);
};

/**
 * Pay of the given members (all members when omitted), per currency:
 * - commission: earned = commissions of their non-cancelled sales (each in the currency of its sale);
 *   remaining = everything earned − every advance and payment, so it returns to 0 once all is paid,
 *   while earlier periods' unpaid amounts are carried over (never lost, never deducted twice);
 * - fixed salary: earned = the monthly salary for the current month, in the base currency;
 *   remaining = salary − what was paid this month.
 */
export const summarizePay = async (staffIds?: string[], transaction?: Transaction): Promise<StaffPay[]> => {
  const settings = await settingsService.get(transaction);
  const staffWhere = staffIds ? { id: staffIds } : {};
  const staff = await Staff.findAll({ where: staffWhere, order: [['name', 'ASC']], transaction });
  if (!staff.length) return [];
  const ids = staff.map((member) => member.id);
  const [commissions, payouts, serviceSales] = await Promise.all([
    Commission.findAll({ where: { staffId: ids, cancelledAt: null }, attributes: ['staffId', 'commissionAmount', 'currency', 'date'], transaction }),
    StaffPayout.findAll({ where: { staffId: ids }, attributes: ['staffId', 'kind', 'amount', 'currency', 'createdAt'], transaction }),
    Sale.findAll({
      where: { staffId: ids, status: 'completed' },
      attributes: ['id', 'staffId', 'currency', 'saleDate'],
      include: [{ association: 'items', where: { type: 'service' }, attributes: ['quantity', 'subtotal'] }],
      transaction,
    }),
  ]);

  return staff.map((member) => {
    const fixed = member.payType === 'fixed';
    const period = periodRange(fixed ? 'monthly' : settings.payPeriod);
    const inPeriod = (date: Date) => date >= period.start && date <= period.end;
    const byCurrency = perCurrency((): CurrencyPay => ({ period: emptyAmounts(), total: emptyAmounts(), carriedOver: 0, remaining: 0 }));
    const add = (currency: unknown, date: Date, key: keyof Amounts, value: number) => {
      if (!isCurrency(currency)) return;
      byCurrency[currency].total[key] += value;
      if (inPeriod(date)) byCurrency[currency].period[key] += value;
    };

    for (const sale of serviceSales) {
      if (sale.staffId !== member.id) continue;
      for (const item of (sale.get('items') as SaleItem[])) {
        add(sale.currency, sale.saleDate, 'eligibleRevenue', Number(item.subtotal));
        add(sale.currency, sale.saleDate, 'servicesCount', Number(item.quantity));
      }
    }
    if (!fixed) {
      for (const commission of commissions) {
        if (commission.staffId === member.id) add(commission.currency, commission.date, 'earned', Number(commission.commissionAmount));
      }
    }
    for (const payout of payouts) {
      if (payout.staffId === member.id) add(payout.currency, payout.createdAt, payout.kind === 'advance' ? 'advances' : 'payments', Number(payout.amount));
    }

    for (const currency of currencies) {
      const pay = byCurrency[currency];
      if (fixed) {
        pay.period.earned = currency === settings.baseCurrency ? Number(member.monthlySalary) : 0;
        pay.remaining = pay.period.earned - pay.period.advances - pay.period.payments;
        pay.carriedOver = 0;
      } else {
        pay.remaining = pay.total.earned - pay.total.advances - pay.total.payments;
        pay.carriedOver = pay.remaining - (pay.period.earned - pay.period.advances - pay.period.payments);
      }
      round(pay.period, currency);
      round(pay.total, currency);
      pay.remaining = roundMoney(pay.remaining, currency);
      pay.carriedOver = roundMoney(pay.carriedOver, currency);
    }

    return {
      staffId: member.id, name: member.name, position: member.position, photoUrl: member.photoUrl, status: member.status,
      archivedAt: member.archivedAt, payType: member.payType, commissionRate: Number(member.commissionRate),
      monthlySalary: Number(member.monthlySalary), period, byCurrency,
    };
  });
};

// Services performed by a member (newest first) and their payouts, for their individual page.
export const staffActivity = async (staffId: string) => {
  const [sales, payouts] = await Promise.all([
    Sale.findAll({
      where: { staffId },
      include: [{ association: 'items', where: { type: 'service' } }],
      order: [['saleDate', 'DESC']],
      limit: 500,
    }),
    StaffPayout.findAll({ where: { staffId }, order: [['createdAt', 'DESC']] }),
  ]);
  const itemIds = sales.flatMap((sale) => (sale.get('items') as SaleItem[]).map((item) => item.id));
  const commissions = itemIds.length ? await Commission.findAll({ where: { saleItemId: itemIds } }) : [];
  const services = sales.filter(isStillShown).flatMap((sale) => (sale.get('items') as SaleItem[]).map((item) => {
    const commission = commissions.find((entry) => entry.saleItemId === item.id);
    return {
      saleId: sale.id, receiptNumber: Number(sale.receiptNumber), date: sale.saleDate, name: item.itemName ?? 'Prestation',
      audience: item.audience, quantity: Number(item.quantity), amount: Number(item.subtotal), currency: sale.currency,
      status: sale.status, commission: commission && !commission.cancelledAt ? Number(commission.commissionAmount) : null,
    };
  }));
  return { services, payouts };
};

type PayoutRequest = {
  staffId: string; kind: 'advance' | 'payment'; amount: number; currency: Currency; paymentMethod: string;
  note: string | null; idempotencyKey: string; paidByUserId: string | null;
};

/**
 * Records an advance or a payment. Payments cannot exceed what is due in that currency; advances may
 * (they are deducted from what will be earned). One payout per member at a time (row lock), and a
 * replayed idempotency key returns the original payout instead of paying again.
 */
export const recordPayout = async (request: PayoutRequest) => {
  const toCents = (value: number | string) => Math.round(Number(value) * 100);
  try {
    return await sequelize.transaction(async (transaction) => {
      const member = await Staff.findByPk(request.staffId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!member) throw new PayrollError(404, 'Staff member not found');

      const previous = await StaffPayout.findOne({ where: { idempotencyKey: request.idempotencyKey }, transaction });
      if (previous) {
        if (previous.staffId !== request.staffId || previous.kind !== request.kind || previous.currency !== request.currency ||
            toCents(previous.amount) !== toCents(request.amount)) {
          throw new PayrollError(409, 'Idempotency key already used for another payment');
        }
        return { payout: previous, replayed: true };
      }

      const settings = await settingsService.get(transaction);
      if (member.payType === 'fixed' && request.currency !== settings.baseCurrency) {
        throw new PayrollError(400, 'A fixed salary is paid in the base currency');
      }
      if (request.kind === 'payment') {
        // Same connection as the lock: concurrent payouts of this member wait for it, without starving the pool.
        const [pay] = await summarizePay([request.staffId], transaction);
        const due = pay.byCurrency[request.currency].remaining;
        if (toCents(request.amount) > toCents(due)) throw new PayrollError(409, 'Amount exceeds what is due');
      }

      const payout = await StaffPayout.create({
        staffId: request.staffId, kind: request.kind, amount: request.amount, currency: request.currency,
        paymentMethod: request.paymentMethod, note: request.note, idempotencyKey: request.idempotencyKey, paidByUserId: request.paidByUserId,
      }, { transaction });
      return { payout, replayed: false };
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
      throw new PayrollError(409, 'Idempotency key already used for another payment');
    }
    throw error;
  }
};

export const payoutsBetween = (start: Date, end: Date) =>
  StaffPayout.findAll({ where: { createdAt: { [Op.between]: [start, end] } }, order: [['createdAt', 'ASC']] });
