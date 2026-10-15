import type { Request, Response } from 'express';
import { sequelize } from '../config/database';
import { Commission, Sale, SaleItem, Staff, Service } from '../models';
import { Client } from '../models/Client';
import { Product } from '../models/Product';
import { commissionService } from '../services/commissionServices';
import type { AuthRequest } from '../middleware/authMiddleware';
import { InsufficientStockError, stockService } from '../services/stockService';
import { isUuid } from '../utils/validators';

const saleLimits = { items: 100, quantity: 1000, clientName: 120, exchangeRate: 1_000_000 };

export const saleController = {
  create: async (req: Request, res: Response) => {
    try {
      const { items, paymentMethod, amountPaid } = req.body;
      const currency = req.body.currency ?? 'USD';
      const baseCurrency = req.body.baseCurrency ?? currency;
      const exchangeRate = Number(req.body.exchangeRate);
      const rawClientId = req.body.clientId;
      const rawClientName = req.body.clientName;
      const rawStaffId = req.body.staffId;
      const clientId = typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId.trim() : null;
      const clientName = typeof rawClientName === 'string' ? rawClientName.trim() : '';
      const staffId = typeof rawStaffId === 'string' && rawStaffId.trim() ? rawStaffId.trim() : null;

      const paymentMethods = ['cash', 'momo', 'card', 'transfer', 'other'];
      if ((rawClientId != null && typeof rawClientId !== 'string') ||
          (rawClientName != null && typeof rawClientName !== 'string') ||
          (rawStaffId != null && typeof rawStaffId !== 'string') || (clientId && clientName) ||
          (clientId && !isUuid(clientId)) || (staffId && !isUuid(staffId)) || clientName.length > saleLimits.clientName ||
          !Array.isArray(items) || items.length === 0 || items.length > saleLimits.items ||
          !paymentMethods.includes(paymentMethod) || !['USD', 'CDF'].includes(currency) || !['USD', 'CDF'].includes(baseCurrency) ||
          (currency !== baseCurrency && (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > saleLimits.exchangeRate))) {
        return res.status(400).json({ error: 'Choose at most one client, and provide a payment method and sale items' });
      }
      if (items.some((item: unknown) => {
        if (!item || typeof item !== 'object') return true;
        const line = item as { type?: unknown; itemId?: unknown; quantity?: unknown };
        return !['service', 'product'].includes(String(line.type)) || !isUuid(line.itemId) ||
          !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1 || Number(line.quantity) > saleLimits.quantity;
      })) {
        return res.status(400).json({ error: 'Each item needs a valid type, ID and positive quantity' });
      }

      const result = await sequelize.transaction(async (transaction) => {
        const [client, staff] = await Promise.all([
          clientId ? Client.findByPk(clientId, { transaction, lock: transaction.LOCK.UPDATE }) : Promise.resolve(null),
          staffId ? Staff.findByPk(staffId, { transaction, lock: transaction.LOCK.UPDATE }) : Promise.resolve(null),
        ]);
        if ((clientId && (!client || client.archivedAt)) || (staffId && !staff) || (staff && (staff.status !== 'active' || staff.archivedAt))) {
          throw new Error('Client or active staff member not found');
        }

        const productQuantities = new Map<string, number>();
        for (const rawItem of items) {
          const item = rawItem as { type: 'service' | 'product'; itemId: string; quantity: number };
          if (item.type === 'product') productQuantities.set(item.itemId, (productQuantities.get(item.itemId) ?? 0) + Number(item.quantity));
        }
        const lockedProducts = new Map<string, Product>();
        for (const productId of [...productQuantities.keys()].sort()) {
          const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
          if (!product || product.status !== 'active') throw new Error('Selected catalog item is unavailable');
          if (Number(product.quantityStock) < (productQuantities.get(productId) ?? 0)) throw new InsufficientStockError();
          lockedProducts.set(productId, product);
        }

        const lines: { item: { type: 'service' | 'product'; itemId: string; quantity: number }; price: number; subtotal: number }[] = [];
        for (const input of items) {
          const item = input as { type: 'service' | 'product'; itemId: string; quantity: number };
          const catalogItem = item.type === 'service'
            ? await Service.findByPk(item.itemId, { transaction })
            : lockedProducts.get(item.itemId);
          if (!catalogItem || ('status' in catalogItem && catalogItem.status !== 'active')) throw new Error('Selected catalog item is unavailable');
          const basePrice = Number(item.type === 'service' ? catalogItem.get('price') : catalogItem.get('priceSell'));
          const price = currency === baseCurrency ? basePrice : currency === 'CDF' ? basePrice * exchangeRate : basePrice / exchangeRate;
          lines.push({ item, price, subtotal: price * Number(item.quantity) });
        }

        const totalAmount = lines.reduce((total, line) => total + line.subtotal, 0);
        const paid = amountPaid === undefined ? totalAmount : Number(amountPaid);
        if (!Number.isFinite(paid) || paid < 0 || paid > totalAmount) throw new Error('Amount paid must be between zero and the total');
        const createdSale = await Sale.create({
          clientId: client?.id ?? null, clientName: client ? null : clientName || null,
          staffId: staff?.id ?? null, totalAmount, currency,
          exchangeRateUsed: currency === baseCurrency ? null : exchangeRate,
          paymentMethod, amountPaid: paid,
          remainingAmount: totalAmount - paid, status: 'completed',
        }, { transaction });

        for (const { item, price, subtotal } of lines) {
          const saleItem = await SaleItem.create({
            saleId: createdSale.id, type: item.type, itemId: item.itemId,
            quantity: Number(item.quantity), unitPrice: price, subtotal,
          }, { transaction });
          if (item.type === 'service') {
            if (staff) {
              await commissionService.createCommissionForService(
                staff.id,
                saleItem.id,
                subtotal,
                Number(staff.commissionRate),
                transaction
              );
            }
          }
        }
        const stockAlerts = [];
        for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          const productBefore = lockedProducts.get(productId)!;
          const stockBefore = Number(productBefore.quantityStock);
          const productAfter = await stockService.take(productId, quantity, 'sale', {
            reference: createdSale.id,
            userId: (req as AuthRequest).user?.id,
            requireActive: true,
            transaction,
          });
          const alert = stockService.alertFor(productAfter, stockBefore);
          if (alert) stockAlerts.push(alert);
        }
        if (client) await client.update({ totalSpent: Number(client.totalSpent) + totalAmount, lastVisit: new Date() }, { transaction });
        return { sale: createdSale, stockAlerts };
      });
      res.status(201).json({ ...result.sale.toJSON(), stockAlerts: result.stockAlerts });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create sale';
      const clientError = [
        'Client or active staff member not found', 'Selected catalog item is unavailable',
        'Selected item has an invalid price', 'Insufficient product stock',
        'Amount paid must be between zero and the total',
      ].includes(message);
      if (clientError || error instanceof InsufficientStockError) return res.status(400).json({ error: message });
      // Anything else is internal: log it, but do not send database details to the browser.
      console.error('Sale creation failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      res.status(500).json({ error: 'Failed to create sale' });
    }
  },

  getAll: async (req: Request, res: Response) => {
    try {
      const sales = await Sale.findAll({
        include: [{ association: 'items' }],
        order: [['saleDate', 'DESC']],
      });
      res.json(sales);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  },

  getByClient: async (req: Request, res: Response) => {
    try {
      const clientId = req.params.clientId;
      if (typeof clientId !== 'string') return res.status(400).json({ error: 'Invalid client ID' });
      const sales = await Sale.findAll({
        where: { clientId },
        include: [{ association: 'items' }],
        order: [['saleDate', 'DESC']],
      });
      res.json(sales);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  },

  reset: async (req: AuthRequest, res: Response) => {
    try {
      const cancelledSales = await sequelize.transaction(async (transaction) => {
        const sales = await Sale.findAll({ where: { status: 'completed' }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
        const saleIds = sales.map((sale) => sale.id);
        if (!saleIds.length) return 0;
        const items = await SaleItem.findAll({ where: { saleId: saleIds }, transaction });
        const itemIds = items.map((item) => item.id);
        const unpaid = await Commission.findAll({ where: { saleItemId: itemIds, paid: false }, transaction });
        if (unpaid.length) await Commission.destroy({ where: { id: unpaid.map((commission) => commission.id) }, transaction });
        const productQuantities = new Map<string, number>();
        for (const item of items) {
          if (item.type === 'product') productQuantities.set(item.itemId, (productQuantities.get(item.itemId) ?? 0) + Number(item.quantity));
        }
        for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          await stockService.put(productId, quantity, 'sale_cancel', { reference: 'bulk-cancel', userId: req.user?.id, transaction });
        }
        await Sale.update({ status: 'refunded' }, { where: { id: saleIds }, transaction });
        await Client.update({ totalSpent: 0, lastVisit: null }, { where: {} , transaction });
        return sales.length;
      });
      res.json({ success: true, message: 'Completed sales were cancelled and inventory restored', cancelledSales });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reset sales and cash register' });
    }
  },

  removeById: async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid sale ID' });
      const sale = await sequelize.transaction(async (transaction) => {
        const current = await Sale.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!current || current.status === 'refunded') return current;
        const items = await SaleItem.findAll({ where: { saleId: id }, transaction });
        const itemIds = items.map((item) => item.id);
        const unpaid = await Commission.findAll({ where: { saleItemId: itemIds, paid: false }, transaction });
        if (unpaid.length) await Commission.destroy({ where: { id: unpaid.map((commission) => commission.id) }, transaction });
        const productQuantities = new Map<string, number>();
        for (const item of items) {
          if (item.type === 'product') productQuantities.set(item.itemId, (productQuantities.get(item.itemId) ?? 0) + Number(item.quantity));
        }
        for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          await stockService.put(productId, quantity, 'sale_cancel', { reference: id, userId: req.user?.id, transaction });
        }
        await current.update({ status: 'refunded' }, { transaction });
        if (current.clientId) {
          const client = await Client.findByPk(current.clientId, { transaction, lock: transaction.LOCK.UPDATE });
          if (client) await client.update({ totalSpent: Math.max(0, Number(client.totalSpent) - Number(current.totalAmount)) }, { transaction });
        }
        return current;
      });
      if (!sale) return res.status(404).json({ error: 'Sale not found' });
      res.json({ success: true, message: sale.status === 'refunded' ? 'Sale cancelled and inventory restored' : 'Sale already cancelled' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete sale' });
    }
  },
};