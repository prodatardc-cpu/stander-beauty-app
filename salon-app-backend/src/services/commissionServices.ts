import { sequelize } from '../config/database';
import { Commission, CommissionPayment, Sale, SaleItem, Staff } from '../models';
import { calculateCommission } from '../utils/helpers';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

export class CommissionPaymentError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Amounts are DECIMAL(…, 2): settle them in integer cents to avoid floating-point drift.
const toCents = (value: number | string) => Math.round(Number(value) * 100);

type PaymentRequest = { staffId: string; amount: number; idempotencyKey: string; paidByUserId?: string | null };

export const commissionService = {
  // Créer une commission pour une prestation
  createCommissionForService: async (
    staffId: string,
    saleItemId: string,
    servicePrice: number,
    workerPercentage: number = 40,
    transaction?: Transaction
  ): Promise<Commission> => {
    const { worker, owner } = calculateCommission(servicePrice, workerPercentage);

    const commission = await Commission.create({
      staffId,
      saleItemId,
      servicePrice,
      commissionAmount: worker,
      patronneAmount: owner,
      paid: false,
    }, { transaction });

    return commission;
  },

  // Récupérer les commissions d'un travailleur
  getStaffCommissions: async (
    staffId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<Commission[]> => {
    const where: any = { staffId };

    if (startDate && endDate) {
      where.date = {
        [Op.between]: [startDate, endDate],
      };
    }

    return Commission.findAll({
      where,
      order: [['date', 'DESC']],
    });
  },

  // Calculer les totaux pour un travailleur
  getStaffCommissionTotals: async (staffId: string) => {
    const commissions = await Commission.findAll({ where: { staffId } });

    const total = commissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount.toString()),
      0
    );
    const paid = commissions
      .filter((c) => c.paid)
      .reduce((sum, c) => sum + parseFloat(c.commissionAmount.toString()), 0);
    const remaining = total - paid;

    return {
      total: parseFloat(total.toFixed(2)),
      paid: parseFloat(paid.toFixed(2)),
      remaining: parseFloat(remaining.toFixed(2)),
    };
  },

  // Marquer une commission comme payée
  markAsPaid: async (commissionId: string): Promise<Commission> => {
    const commission = await Commission.findByPk(commissionId);

    if (!commission) {
      throw new Error('Commission not found');
    }

    return commission.update({
      paid: true,
      paymentDate: new Date(),
    });
  },

  // Payer les commissions d'un travailleur : les plus anciennes d'abord, tant que le montant les couvre.
  // Safe against concurrent and repeated requests: payments of one staff member run one at a time
  // (row lock), and a replayed idempotency key returns the original payment instead of paying again.
  payStaffCommissions: async ({ staffId, amount, idempotencyKey, paidByUserId = null }: PaymentRequest) => {
    const requested = toCents(amount);
    try {
      return await sequelize.transaction(async (transaction) => {
        const staff = await Staff.findByPk(staffId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!staff) throw new CommissionPaymentError(404, 'Staff member not found');

        const previous = await CommissionPayment.findOne({ where: { idempotencyKey }, transaction });
        if (previous) {
          if (previous.staffId !== staffId || toCents(previous.requestedAmount) !== requested) {
            throw new CommissionPaymentError(409, 'Idempotency key already used for another payment');
          }
          return { payment: previous, remaining: (requested - toCents(previous.amount)) / 100, replayed: true };
        }

        const unpaid = await Commission.findAll({
          where: { staffId, paid: false },
          order: [['date', 'ASC'], ['id', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        let left = requested;
        const settled: Commission[] = [];
        for (const commission of unpaid) {
          if (left <= 0) break;
          const due = toCents(commission.commissionAmount);
          if (due <= left) {
            settled.push(commission);
            left -= due;
          }
        }
        if (!settled.length) throw new CommissionPaymentError(409, 'No unpaid commission is covered by this amount');

        const payment = await CommissionPayment.create({
          staffId, amount: (requested - left) / 100, requestedAmount: requested / 100,
          commissionCount: settled.length, idempotencyKey, paidByUserId,
        }, { transaction });
        const [updated] = await Commission.update(
          { paid: true, paymentDate: payment.createdAt, paymentId: payment.id },
          { where: { id: settled.map((commission) => commission.id), paid: false }, transaction }
        );
        if (updated !== settled.length) throw new Error('Commissions changed during the payment');
        return { payment, remaining: left / 100, replayed: false };
      });
    } catch (error) {
      // Same key sent concurrently for another staff member: the unique index rejected the second one.
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        throw new CommissionPaymentError(409, 'Idempotency key already used for another payment');
      }
      throw error;
    }
  },

  // Vérifier la validité des commissions (audit)
  verifyCommissions: async (
    startDate: Date,
    endDate: Date
  ): Promise<{ valid: number; errors: string[] }> => {
    const sales = await Sale.findAll({
      where: {
        saleDate: {
          [Op.between]: [startDate, endDate],
        },
      },
      include: [{ association: 'items' }],
    });

    const errors: string[] = [];
    let validCount = 0;

    const staffRates = new Map<string, number>(
      (await Staff.findAll({ attributes: ['id', 'commissionRate'] })).map((staff) => [
        staff.id,
        Number(staff.commissionRate),
      ] as const)
    );

    for (const sale of sales) {
      const items = sale.get('items') as SaleItem[];
      for (const item of items) {
        if (item.type === 'service' && sale.staffId) {
          const commission = await Commission.findOne({
            where: { saleItemId: item.id },
          });

          if (!commission) {
            errors.push(
              `Missing commission for service item ${item.id} in sale ${sale.id}`
            );
          } else {
            const servicePrice = parseFloat(item.subtotal.toString());
            const expectedWorker = calculateCommission(
              servicePrice,
              staffRates.get(sale.staffId) ?? 40
            ).worker;

            if (
              parseFloat(commission.commissionAmount.toString()) !==
              expectedWorker
            ) {
              errors.push(
                `Invalid commission amount for item ${item.id} in sale ${sale.id}`
              );
            } else {
              validCount++;
            }
          }
        }
      }
    }

    return { valid: validCount, errors };
  },
};