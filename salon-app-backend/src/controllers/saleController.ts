import type { Request, Response } from 'express';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { sequelize } from '../config/database';
import { Commission, Sale, SaleItem, SalePayment, Staff, Service } from '../models';
import { Client } from '../models/Client';
import { Product } from '../models/Product';
import { commissionService } from '../services/commissionServices';
import type { AuthRequest } from '../middleware/authMiddleware';
import { cancelledVisibleSince, saleNames, userEmails } from '../services/operationsService';
import { settingsService } from '../services/settingsService';
import { InsufficientStockError, stockService } from '../services/stockService';
import { convertMoney, isCurrency, roundMoney } from '../utils/money';
import { isUuid } from '../utils/validators';

const saleLimits = { items: 100, quantity: 1000, clientName: 120, reason: 255, unitPrice: 99_999_999 };
const audiences = ['women', 'men'];
const paymentMethods = ['cash', 'momo', 'card', 'transfer', 'other'];
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,100}$/;

// unitPrice: a service price set by the cashier, in the sale's currency (the catalogue price otherwise).
type SaleLine = { type: 'service' | 'product'; itemId: string; quantity: number; audience?: 'women' | 'men'; unitPrice?: number };

class SaleError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const pricesChanged = () => new SaleError(409, 'Prices or exchange rate changed; reload the till');

// What the sale added to its client's total, in today's base currency. Sales recorded before base
// amounts were kept count their total as it is, as they did then.
const baseAmountOf = async (sale: Sale, transaction: Transaction) => {
  if (sale.baseAmount == null || !isCurrency(sale.baseCurrency)) return Number(sale.totalAmount);
  const { baseCurrency, usdToCdfRate } = await settingsService.get(transaction);
  if (sale.baseCurrency === baseCurrency || !usdToCdfRate) return Number(sale.baseAmount);
  return roundMoney(convertMoney(Number(sale.baseAmount), sale.baseCurrency, baseCurrency, usdToCdfRate), baseCurrency);
};

/**
 * Cancels a completed sale in one transaction: products go back to stock, its commissions are marked
 * cancelled (kept on record), the client's total is reduced, and the sale keeps its lines and payments
 * with the cancellation time, author and reason. What had been paid appears as a refund in the cash
 * journal. Cancelling twice is refused, so nothing is ever reversed twice.
 */
const cancelSale = async (id: string, userId: string | null, reason: string | null, transaction: Transaction) => {
  const sale = await Sale.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!sale) throw new SaleError(404, 'Sale not found');
  if (sale.status === 'refunded') throw new SaleError(409, 'Sale already cancelled');
  const items = await SaleItem.findAll({ where: { saleId: id }, transaction });
  const now = new Date();
  await Commission.update({ cancelledAt: now }, { where: { saleItemId: items.map((item) => item.id), cancelledAt: null }, transaction });
  const productQuantities = new Map<string, number>();
  for (const item of items) {
    if (item.type === 'product') productQuantities.set(item.itemId, (productQuantities.get(item.itemId) ?? 0) + Number(item.quantity));
  }
  for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await stockService.put(productId, quantity, 'sale_cancel', { reference: id, userId, transaction });
  }
  if (sale.clientId) {
    const client = await Client.findByPk(sale.clientId, { transaction, lock: transaction.LOCK.UPDATE });
    if (client) await client.update({ totalSpent: Math.max(0, Number(client.totalSpent) - await baseAmountOf(sale, transaction)) }, { transaction });
  }
  await sale.update({ status: 'refunded', cancelledAt: now, cancelledByUserId: userId, cancelReason: reason }, { transaction });
  return sale;
};

const parseReason = (value: unknown) => {
  if (value == null || value === '') return { reason: null };
  if (typeof value !== 'string' || value.length > saleLimits.reason) return { invalid: true as const };
  return { reason: value.trim() || null };
};

export const saleController = {
  create: async (req: AuthRequest, res: Response) => {
    try {
      const { items, paymentMethod, amountPaid, expectedTotal } = req.body ?? {};
      // Prices come from the catalogue, in the salon's base currency, converted at the salon's rate:
      // the client only chooses the currency of the sale (baseCurrency/exchangeRate it sends are ignored).
      const requestedCurrency = req.body?.currency;
      const rawClientId = req.body?.clientId;
      const rawClientName = req.body?.clientName;
      const rawStaffId = req.body?.staffId;
      const clientId = typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId.trim() : null;
      const clientName = typeof rawClientName === 'string' ? rawClientName.trim() : '';
      const staffId = typeof rawStaffId === 'string' && rawStaffId.trim() ? rawStaffId.trim() : null;

      if ((rawClientId != null && typeof rawClientId !== 'string') ||
          (rawClientName != null && typeof rawClientName !== 'string') ||
          (rawStaffId != null && typeof rawStaffId !== 'string') || (clientId && clientName) ||
          (clientId && !isUuid(clientId)) || (staffId && !isUuid(staffId)) || clientName.length > saleLimits.clientName ||
          !Array.isArray(items) || items.length === 0 || items.length > saleLimits.items ||
          !paymentMethods.includes(paymentMethod) || (requestedCurrency != null && !isCurrency(requestedCurrency)) ||
          (expectedTotal != null && (typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal)))) {
        return res.status(400).json({ error: 'Choose at most one client, and provide a payment method and sale items' });
      }
      if (items.some((item: unknown) => {
        if (!item || typeof item !== 'object') return true;
        const line = item as { type?: unknown; itemId?: unknown; quantity?: unknown; audience?: unknown; unitPrice?: unknown };
        return !['service', 'product'].includes(String(line.type)) || !isUuid(line.itemId) ||
          (line.unitPrice != null && (line.type !== 'service' || typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice) ||
            line.unitPrice < 0 || line.unitPrice > saleLimits.unitPrice)) ||
          (line.audience != null && (line.type !== 'service' || !audiences.includes(String(line.audience)))) ||
          !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1 || Number(line.quantity) > saleLimits.quantity;
      })) {
        return res.status(400).json({ error: 'Each item needs a valid type, ID and positive quantity' });
      }

      const result = await sequelize.transaction(async (transaction) => {
        const settings = await settingsService.get(transaction);
        const baseCurrency = settings.baseCurrency;
        const currency = isCurrency(requestedCurrency) ? requestedCurrency : baseCurrency;
        const rate = settings.usdToCdfRate;
        if (currency !== baseCurrency && !rate) throw new SaleError(400, 'No exchange rate is configured for this currency');
        // Explicit conversion chosen at the till (the rate is shown there and stored on the sale).
        const toSaleCurrency = (amount: number) => roundMoney(convertMoney(amount, baseCurrency, currency, rate ?? 1), currency);

        const [client, staff] = await Promise.all([
          clientId ? Client.findByPk(clientId, { transaction, lock: transaction.LOCK.UPDATE }) : Promise.resolve(null),
          staffId ? Staff.findByPk(staffId, { transaction, lock: transaction.LOCK.UPDATE }) : Promise.resolve(null),
        ]);
        if ((clientId && (!client || client.archivedAt)) || (staffId && !staff) || (staff && (staff.status !== 'active' || staff.archivedAt))) {
          throw new SaleError(400, 'Client or active staff member not found');
        }

        const productQuantities = new Map<string, number>();
        for (const rawItem of items) {
          const item = rawItem as SaleLine;
          if (item.type === 'product') productQuantities.set(item.itemId, (productQuantities.get(item.itemId) ?? 0) + Number(item.quantity));
        }
        const lockedProducts = new Map<string, Product>();
        for (const productId of [...productQuantities.keys()].sort()) {
          const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
          if (!product || product.status !== 'active') throw new SaleError(400, 'Selected catalog item is unavailable');
          if (Number(product.quantityStock) < (productQuantities.get(productId) ?? 0)) throw new InsufficientStockError();
          lockedProducts.set(productId, product);
        }

        const lines: { item: SaleLine; name: string; audience: 'women' | 'men' | null; price: number; subtotal: number; unitCost: number | null; catalogUnitPrice: number | null }[] = [];
        for (const input of items) {
          const item = input as SaleLine;
          let basePrice: number;
          let name: string;
          let unitCost: number | null = null;
          let audience: 'women' | 'men' | null = null;
          if (item.type === 'service') {
            const service = await Service.findByPk(item.itemId, { transaction });
            if (!service || service.status !== 'active') throw new SaleError(400, 'Selected catalog item is unavailable');
            // A women-only or men-only service is always charged at that audience's price.
            audience = item.audience ?? (service.audience === 'unisex' ? null : service.audience);
            if (audience && service.audience !== 'unisex' && audience !== service.audience) throw new SaleError(400, 'Selected catalog item is unavailable');
            const audiencePrice = audience === 'women' ? service.womenPrice : audience === 'men' ? service.menPrice : null;
            basePrice = Number(audiencePrice ?? service.price);
            name = service.name;
          } else {
            const product = lockedProducts.get(item.itemId);
            if (!product) throw new SaleError(400, 'Selected catalog item is unavailable');
            basePrice = Number(product.priceSell);
            unitCost = toSaleCurrency(Number(product.priceBuy));
            name = product.name;
          }
          const catalogPrice = toSaleCurrency(basePrice);
          // The cashier may charge another price for a service; the catalogue price is kept alongside.
          const price = item.type === 'service' && item.unitPrice != null ? roundMoney(item.unitPrice, currency) : catalogPrice;
          lines.push({
            item, name, audience, price, unitCost, subtotal: roundMoney(price * Number(item.quantity), currency),
            catalogUnitPrice: price !== catalogPrice ? catalogPrice : null,
          });
        }

        const totalAmount = roundMoney(lines.reduce((total, line) => total + line.subtotal, 0), currency);
        // The till shows a total computed from its copy of the catalogue and rate: never charge another one.
        if (expectedTotal != null && roundMoney(expectedTotal, currency) !== totalAmount) throw pricesChanged();
        const paid = amountPaid === undefined || amountPaid === null ? totalAmount : roundMoney(Number(amountPaid), currency);
        if (!Number.isFinite(paid) || paid < 0 || paid > totalAmount) throw new SaleError(400, 'Amount paid must be between zero and the total');
        const baseAmount = roundMoney(convertMoney(totalAmount, currency, baseCurrency, rate ?? 1), baseCurrency);
        const createdSale = await Sale.create({
          clientId: client?.id ?? null, clientName: client ? null : clientName || null,
          staffId: staff?.id ?? null, totalAmount, currency,
          exchangeRateUsed: currency === baseCurrency ? null : rate, baseCurrency, baseAmount,
          paymentMethod, amountPaid: paid, createdByUserId: req.user?.id ?? null,
          remainingAmount: roundMoney(totalAmount - paid, currency), status: 'completed',
        }, { transaction });
        if (paid > 0) {
          await SalePayment.create({
            saleId: createdSale.id, kind: 'sale', amount: paid, currency, paymentMethod, userId: req.user?.id ?? null,
          }, { transaction });
        }

        for (const { item, name, audience, price, subtotal, unitCost, catalogUnitPrice } of lines) {
          const saleItem = await SaleItem.create({
            saleId: createdSale.id, type: item.type, itemId: item.itemId, itemName: name, audience, unitCost, catalogUnitPrice,
            quantity: Number(item.quantity), unitPrice: price, subtotal,
          }, { transaction });
          // Members on a fixed salary earn no commission.
          if (item.type === 'service' && staff && staff.payType !== 'fixed') {
            await commissionService.createCommissionForService(
              staff.id,
              saleItem.id,
              subtotal,
              currency,
              Number(staff.commissionRate),
              transaction
            );
          }
        }
        const stockAlerts = [];
        for (const [productId, quantity] of [...productQuantities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
          const productBefore = lockedProducts.get(productId)!;
          const stockBefore = Number(productBefore.quantityStock);
          const productAfter = await stockService.take(productId, quantity, 'sale', {
            reference: createdSale.id,
            userId: req.user?.id,
            requireActive: true,
            transaction,
          });
          const alert = stockService.alertFor(productAfter, stockBefore);
          if (alert) stockAlerts.push(alert);
        }
        // The client's total is kept in the base currency, whatever the currency of each sale.
        if (client) await client.update({ totalSpent: roundMoney(Number(client.totalSpent) + baseAmount, baseCurrency), lastVisit: new Date() }, { transaction });
        return { sale: createdSale, stockAlerts };
      });
      // Re-read: the receipt number is assigned by the database.
      const saved = await Sale.findByPk(result.sale.id, { include: [{ association: 'items' }, { association: 'payments' }] });
      res.status(201).json({ ...saved!.toJSON(), stockAlerts: result.stockAlerts });
    } catch (error) {
      if (error instanceof SaleError) return res.status(error.status).json({ error: error.message });
      if (error instanceof InsufficientStockError) return res.status(400).json({ error: error.message });
      // Anything else is internal: log it, but do not send database details to the browser.
      console.error('Sale creation failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      res.status(500).json({ error: 'Failed to create sale' });
    }
  },

  // Filters: status (completed|refunded), currency, startDate/endDate (YYYY-MM-DD), staffId, withDebt.
  getAll: async (req: Request, res: Response) => {
    const { status, currency, startDate, endDate, staffId, withDebt } = req.query;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if ((status !== undefined && !['completed', 'refunded'].includes(String(status))) ||
        (currency !== undefined && !isCurrency(currency)) ||
        (startDate !== undefined && (typeof startDate !== 'string' || !datePattern.test(startDate))) ||
        (endDate !== undefined && (typeof endDate !== 'string' || !datePattern.test(endDate))) ||
        (staffId !== undefined && !isUuid(staffId))) {
      return res.status(400).json({ error: 'Invalid sale filters' });
    }
    try {
      const where: WhereOptions = {
        // Cancelled sales are listed for 7 days after their cancellation, then no longer shown.
        [Op.or]: [{ status: 'completed' }, { cancelledAt: { [Op.gte]: cancelledVisibleSince() } }],
        ...(status && { status: String(status) }),
        ...(currency && { currency: String(currency) }),
        ...(staffId && { staffId: String(staffId) }),
        ...(withDebt === 'true' && { remainingAmount: { [Op.gt]: 0 }, status: 'completed' }),
        ...((startDate || endDate) && {
          saleDate: {
            ...(startDate && { [Op.gte]: new Date(`${startDate}T00:00:00`) }),
            ...(endDate && { [Op.lte]: new Date(`${endDate}T23:59:59.999`) }),
          },
        }),
      };
      const sales = await Sale.findAll({
        where,
        include: [{ association: 'items' }, { association: 'payments' }],
        order: [['saleDate', 'DESC']],
        // Without any filter, the latest 500 sales; filtered lists are complete.
        ...(!startDate && !endDate && !status && !staffId && withDebt !== 'true' && { limit: 500 }),
      });
      res.json(sales);
    } catch {
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  },

  // Everything a receipt needs: lines, payments, names, authors and the business details.
  getOne: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid sale ID' });
    try {
      const sale = await Sale.findByPk(id, {
        include: [{ association: 'items' }, { association: 'payments' }],
        order: [[{ model: SalePayment, as: 'payments' }, 'createdAt', 'ASC']],
      });
      if (!sale) return res.status(404).json({ error: 'Sale not found' });
      const [names, settings] = await Promise.all([saleNames([sale]), settingsService.get()]);
      const payments = (sale.get('payments') as SalePayment[]);
      const emails = await userEmails([sale.createdByUserId, sale.cancelledByUserId, ...payments.map((payment) => payment.userId)]);
      res.json({
        ...sale.toJSON(),
        clientLabel: names.client(sale), staffName: names.staff(sale),
        createdByEmail: sale.createdByUserId ? emails.get(sale.createdByUserId) ?? null : null,
        cancelledByEmail: sale.cancelledByUserId ? emails.get(sale.cancelledByUserId) ?? null : null,
        business: {
          businessName: settings.businessName, businessEmail: settings.businessEmail, businessPhone: settings.businessPhone,
          taxId: settings.taxId, businessAddress: settings.businessAddress,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch sale' });
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

  // Settles all or part of what a client still owes on a sale, in the sale's currency.
  // An Idempotency-Key header makes a retried request record the payment only once.
  addPayment: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const { amount, paymentMethod } = req.body ?? {};
    const idempotencyKey = req.get('Idempotency-Key') ?? null;
    if (!isUuid(id) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !paymentMethods.includes(paymentMethod) ||
        (idempotencyKey !== null && !idempotencyKeyPattern.test(idempotencyKey))) {
      return res.status(400).json({ error: 'A positive amount and a payment method are required' });
    }
    try {
      const result = await sequelize.transaction(async (transaction) => {
        if (idempotencyKey) {
          const previous = await SalePayment.findOne({ where: { idempotencyKey }, transaction });
          if (previous) {
            if (previous.saleId !== id || Math.round(Number(previous.amount) * 100) !== Math.round(amount * 100)) {
              throw new SaleError(409, 'Idempotency key already used for another payment');
            }
            return { payment: previous, replayed: true };
          }
        }
        const sale = await Sale.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!sale) throw new SaleError(404, 'Sale not found');
        if (sale.status !== 'completed') throw new SaleError(409, 'Sale already cancelled');
        if (!isCurrency(sale.currency)) throw new SaleError(409, 'This sale has no recorded currency');
        const paid = roundMoney(amount, sale.currency);
        const remaining = Number(sale.remainingAmount);
        if (paid <= 0 || paid > remaining) throw new SaleError(409, 'Amount exceeds the remaining balance');
        const payment = await SalePayment.create({
          saleId: id, kind: 'debt', amount: paid, currency: sale.currency, paymentMethod, idempotencyKey, userId: req.user?.id ?? null,
        }, { transaction });
        await sale.update({
          amountPaid: roundMoney(Number(sale.amountPaid) + paid, sale.currency),
          remainingAmount: roundMoney(remaining - paid, sale.currency),
        }, { transaction });
        return { payment, replayed: false };
      });
      const sale = await Sale.findByPk(id, { include: [{ association: 'items' }, { association: 'payments' }] });
      res.status(result.replayed ? 200 : 201).json({ sale, payment: result.payment, replayed: result.replayed });
    } catch (error) {
      if (error instanceof SaleError) return res.status(error.status).json({ error: error.message });
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Idempotency key already used for another payment' });
      }
      res.status(500).json({ error: 'Failed to record the payment' });
    }
  },

  reset: async (req: AuthRequest, res: Response) => {
    try {
      const cancelledSales = await sequelize.transaction(async (transaction) => {
        const sales = await Sale.findAll({ where: { status: 'completed' }, order: [['id', 'ASC']], attributes: ['id'], transaction });
        for (const sale of sales) await cancelSale(sale.id, req.user?.id ?? null, 'Annulation générale de la caisse', transaction);
        return sales.length;
      });
      res.json({ success: true, message: 'Completed sales were cancelled and inventory restored', cancelledSales });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reset sales and cash register' });
    }
  },

  // POST /sales/:id/cancel { reason } — and DELETE /sales/:id, kept for older clients.
  cancel: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid sale ID' });
    const parsed = parseReason(req.body?.reason);
    if ('invalid' in parsed) return res.status(400).json({ error: 'The reason must be at most 255 characters' });
    try {
      const sale = await sequelize.transaction((transaction) => cancelSale(id, req.user?.id ?? null, parsed.reason, transaction));
      res.json({ success: true, message: 'Sale cancelled and inventory restored', sale });
    } catch (error) {
      if (error instanceof SaleError) return res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: 'Failed to cancel sale' });
    }
  },
};
