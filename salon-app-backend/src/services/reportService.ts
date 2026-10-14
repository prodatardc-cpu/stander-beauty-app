import { Sale, Commission, Staff, SaleItem, Expense } from '../models';
import { Op } from 'sequelize';

export const reportService = {
  // Rapport par période
  getReportByPeriod: async (startDate: Date, endDate: Date) => {
    const sales = await Sale.findAll({
      where: {
        status: 'completed',
        saleDate: {
          [Op.between]: [startDate, endDate],
        },
      },
      include: [{ association: 'items' }],
    });

    let totalSales = 0;
    let serviceRevenue = 0;
    let productRevenue = 0;

    for (const sale of sales) {
      for (const item of (sale as any).items) {
        const amount = parseFloat(item.subtotal.toString());
        totalSales += amount;
        if (item.type === 'service') {
          serviceRevenue += amount;
        } else {
          productRevenue += amount;
        }
      }
    }

    const saleItemIds = sales.flatMap((sale) => ((sale as any).items ?? []).map((item: SaleItem) => item.id));
    const commissions = await Commission.findAll({
      where: {
        saleItemId: saleItemIds,
        date: {
          [Op.between]: [startDate, endDate],
        },
      },
    });

    const totalCommissions = commissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount.toString()),
      0
    );

    const expenses = await Expense.findAll({ where: { createdAt: { [Op.between]: [startDate, endDate] } } });
    const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const amountReceived = sales.reduce((sum, sale) => sum + Number(sale.amountPaid), 0);
    const outstandingAmount = sales.reduce((sum, sale) => sum + Number(sale.remainingAmount), 0);

    return {
      period: { start: startDate, end: endDate },
      totalSales: parseFloat(totalSales.toFixed(2)),
      serviceRevenue: parseFloat(serviceRevenue.toFixed(2)),
      productRevenue: parseFloat(productRevenue.toFixed(2)),
      totalCommissions: parseFloat(totalCommissions.toFixed(2)),
      amountReceived: parseFloat(amountReceived.toFixed(2)),
      outstandingAmount: parseFloat(outstandingAmount.toFixed(2)),
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
      netBalance: parseFloat((amountReceived - totalExpenses).toFixed(2)),
      transactionCount: sales.length,
      expenseCount: expenses.length,
    };
  },

  // Rapport par travailleur
  getReportByStaff: async (staffId: string, startDate: Date, endDate: Date) => {
    const staff = await Staff.findByPk(staffId);

    const sales = await Sale.findAll({
      where: {
        staffId,
        status: 'completed',
        saleDate: {
          [Op.between]: [startDate, endDate],
        },
      },
      include: [{ association: 'items' }],
    });

    let totalSales = 0;
    for (const sale of sales) {
      for (const item of (sale as any).items) {
        totalSales += parseFloat(item.subtotal.toString());
      }
    }

    const commissions = await Commission.findAll({
      where: {
        staffId,
        date: {
          [Op.between]: [startDate, endDate],
        },
      },
    });

    const totalCommissions = commissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount.toString()),
      0
    );
    const paidCommissions = commissions
      .filter((c) => c.paid)
      .reduce((sum, c) => sum + parseFloat(c.commissionAmount.toString()), 0);

    return {
      staff: staff?.dataValues,
      period: { start: startDate, end: endDate },
      totalSales: parseFloat(totalSales.toFixed(2)),
      totalCommissions: parseFloat(totalCommissions.toFixed(2)),
      paidCommissions: parseFloat(paidCommissions.toFixed(2)),
      remainingCommissions: parseFloat(
        (totalCommissions - paidCommissions).toFixed(2)
      ),
      transactionCount: sales.length,
    };
  },

  // Rapport par service
  getReportByService: async (
    serviceId: string,
    startDate: Date,
    endDate: Date
  ) => {
    const saleItems = await SaleItem.findAll({
      where: {
        itemId: serviceId,
        type: 'service',
      },
      include: [
        {
          association: 'Sale',
          where: {
            status: 'completed',
            saleDate: {
              [Op.between]: [startDate, endDate],
            },
          },
        },
      ],
    });

    const totalRevenue = saleItems.reduce(
      (sum, item) => sum + parseFloat(item.subtotal.toString()),
      0
    );

    const commissions = await Commission.findAll({
      where: {
        date: {
          [Op.between]: [startDate, endDate],
        },
      },
      include: [
        {
          association: 'SaleItem',
          where: { itemId: serviceId },
        },
      ],
    });

    const totalCommissions = commissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount.toString()),
      0
    );

    return {
      serviceId,
      period: { start: startDate, end: endDate },
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalCommissions: parseFloat(totalCommissions.toFixed(2)),
      saleCount: saleItems.length,
    };
  },

  // Rapport par produit
  getReportByProduct: async (
    productId: string,
    startDate: Date,
    endDate: Date
  ) => {
    const saleItems = await SaleItem.findAll({
      where: {
        itemId: productId,
        type: 'product',
      },
      include: [
        {
          association: 'Sale',
          where: {
            status: 'completed',
            saleDate: {
              [Op.between]: [startDate, endDate],
            },
          },
        },
      ],
    });

    const totalQuantity = saleItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const totalRevenue = saleItems.reduce(
      (sum, item) => sum + parseFloat(item.subtotal.toString()),
      0
    );

    return {
      productId,
      period: { start: startDate, end: endDate },
      totalQuantity,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      saleCount: saleItems.length,
    };
  },

  // Dashboard principal
  getDashboardStats: async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Ventes d'aujourd'hui
    const todaySales = await Sale.findAll({
      where: {
        status: 'completed',
        saleDate: {
          [Op.gte]: today,
          [Op.lt]: tomorrow,
        },
      },
      include: [{ association: 'items' }],
    });

    let todayServiceCount = 0;
    let todayServiceRevenue = 0;
    let todayProductCount = 0;
    let todayProductRevenue = 0;
    let todayServiceRevenueUSD = 0;
    let todayServiceRevenueCDF = 0;
    let todayProductRevenueUSD = 0;
    let todayProductRevenueCDF = 0;
    let amountReceivedTodayUSD = 0;
    let amountReceivedTodayCDF = 0;
    for (const sale of todaySales) {
      if (sale.currency === 'CDF') amountReceivedTodayCDF += Number(sale.amountPaid);
      else amountReceivedTodayUSD += Number(sale.amountPaid);
      for (const item of (sale as any).items) {
        const itemRevenue = parseFloat(item.subtotal.toString());
        if (item.type === 'service') {
          todayServiceCount += item.quantity;
          todayServiceRevenue += itemRevenue;
          if (sale.currency === 'CDF') todayServiceRevenueCDF += itemRevenue;
          else todayServiceRevenueUSD += itemRevenue;
        } else if (item.type === 'product') {
          todayProductCount += item.quantity;
          todayProductRevenue += itemRevenue;
          if (sale.currency === 'CDF') todayProductRevenueCDF += itemRevenue;
          else todayProductRevenueUSD += itemRevenue;
        }
      }
    }

    // Commissions à payer
    const unpaidCommissions = await Commission.findAll({
      where: { paid: false },
      include: [{ association: 'SaleItem', include: [{ association: 'Sale' }] }],
    });

    const totalUnpaid = unpaidCommissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount.toString()),
      0
    );
    const totalUnpaidUSD = unpaidCommissions.reduce((sum, commission) => {
      const saleCurrency = (commission as any).SaleItem?.Sale?.currency;
      return saleCurrency === 'USD' ? sum + Number(commission.commissionAmount) : sum;
    }, 0);
    const totalUnpaidCDF = unpaidCommissions.reduce((sum, commission) => {
      const saleCurrency = (commission as any).SaleItem?.Sale?.currency;
      return saleCurrency === 'CDF' ? sum + Number(commission.commissionAmount) : sum;
    }, 0);

    return {
      todayServiceCount,
      todayServiceRevenue: parseFloat(todayServiceRevenue.toFixed(2)),
      todayProductCount,
      todayProductRevenue: parseFloat(todayProductRevenue.toFixed(2)),
      todayRevenue: parseFloat((todayServiceRevenue + todayProductRevenue).toFixed(2)),
      todayRevenueUSD: parseFloat(amountReceivedTodayUSD.toFixed(2)),
      todayRevenueCDF: parseFloat(amountReceivedTodayCDF.toFixed(2)),
      amountReceivedTodayUSD: parseFloat(amountReceivedTodayUSD.toFixed(2)),
      amountReceivedTodayCDF: parseFloat(amountReceivedTodayCDF.toFixed(2)),
      todayServiceRevenueUSD: parseFloat(todayServiceRevenueUSD.toFixed(2)),
      todayServiceRevenueCDF: parseFloat(todayServiceRevenueCDF.toFixed(2)),
      todayProductRevenueUSD: parseFloat(todayProductRevenueUSD.toFixed(2)),
      todayProductRevenueCDF: parseFloat(todayProductRevenueCDF.toFixed(2)),
      unpaidCommissions: parseFloat(totalUnpaid.toFixed(2)),
      unpaidCommissionsUSD: parseFloat(totalUnpaidUSD.toFixed(2)),
      unpaidCommissionsCDF: parseFloat(totalUnpaidCDF.toFixed(2)),
      unpaidCommissionCount: unpaidCommissions.length,
    };
  },
};