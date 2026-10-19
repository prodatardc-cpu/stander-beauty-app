import { Commission } from '../models';
import { calculateCommission } from '../utils/helpers';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import type { Currency } from '../utils/money';

export const commissionService = {
  // Créer une commission pour une prestation
  createCommissionForService: async (
    staffId: string,
    saleItemId: string,
    servicePrice: number,
    currency: Currency,
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
      currency,
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
};
