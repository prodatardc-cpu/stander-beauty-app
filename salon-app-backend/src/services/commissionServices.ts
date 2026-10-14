import { Commission, Sale, SaleItem, Staff } from '../models';
import { calculateCommission } from '../utils/helpers';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

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

  // Payer les commissions d'un travailleur
  payStaffCommissions: async (
    staffId: string,
    amount: number
  ): Promise<{ paid: number; remaining: number }> => {
    const unpaidCommissions = await Commission.findAll({
      where: { staffId, paid: false },
      order: [['date', 'ASC']],
    });

    let remaining = parseFloat(amount.toString());
    let totalPaid = 0;

    for (const commission of unpaidCommissions) {
      if (remaining <= 0) break;

      const commissionAmount = parseFloat(
        commission.commissionAmount.toString()
      );

      if (remaining >= commissionAmount) {
        await commission.update({
          paid: true,
          paymentDate: new Date(),
        });
        remaining -= commissionAmount;
        totalPaid += commissionAmount;
      }
    }

    return {
      paid: parseFloat(totalPaid.toFixed(2)),
      remaining: parseFloat(remaining.toFixed(2)),
    };
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