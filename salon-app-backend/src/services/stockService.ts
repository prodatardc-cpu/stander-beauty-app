import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../config/database';
import { Product, StockMovement } from '../models';
import type { StockMovementReason } from '../models/StockMovement';

export class InsufficientStockError extends Error {
  constructor() {
    super('Insufficient product stock');
  }
}

type MovementOptions = { reference?: string | null; note?: string | null; userId?: string | null; transaction?: Transaction; requireActive?: boolean };

export type StockAlert = { productId: string; name: string; quantityStock: number; lowStockThreshold: number; level: 'low' | 'out' };

const record = (productId: string, type: 'in' | 'out', reason: StockMovementReason, quantity: number, stockAfter: number, options: MovementOptions) =>
  StockMovement.create({
    productId, type, reason, quantity, stockAfter,
    reference: options.reference ?? null, note: options.note ?? null, userId: options.userId ?? null,
  }, { transaction: options.transaction });

export const stockService = {
  record,

  take: async (productId: string, quantity: number, reason: StockMovementReason, options: MovementOptions) => {
    const amount = Math.trunc(quantity);
    const [affected] = await Product.update(
      { quantityStock: sequelize.literal(`"quantityStock" - ${amount}`) },
      { where: { id: productId, quantityStock: { [Op.gte]: amount }, ...(options.requireActive && { status: 'active' }) }, transaction: options.transaction }
    );
    if (affected !== 1) throw new InsufficientStockError();
    const product = await Product.findByPk(productId, { transaction: options.transaction });
    if (!product) throw new InsufficientStockError();
    await record(productId, 'out', reason, amount, product.quantityStock, options);
    return product;
  },

  put: async (productId: string, quantity: number, reason: StockMovementReason, options: MovementOptions & { countAsReceived?: boolean }) => {
    const amount = Math.trunc(quantity);
    await Product.update(
      {
        quantityStock: sequelize.literal(`"quantityStock" + ${amount}`),
        ...(options.countAsReceived && { quantityReceived: sequelize.literal(`"quantityReceived" + ${amount}`) }),
      },
      { where: { id: productId }, transaction: options.transaction }
    );
    const product = await Product.findByPk(productId, { transaction: options.transaction });
    if (!product) return null;
    await record(productId, 'in', reason, amount, product.quantityStock, options);
    return product;
  },

  alertFor: (product: Product, stockBefore: number): StockAlert | null => {
    const threshold = Number(product.lowStockThreshold ?? 0);
    const after = Number(product.quantityStock);
    if (after <= 0 && stockBefore > 0) return { productId: product.id, name: product.name, quantityStock: after, lowStockThreshold: threshold, level: 'out' };
    if (after <= threshold && stockBefore > threshold) return { productId: product.id, name: product.name, quantityStock: after, lowStockThreshold: threshold, level: 'low' };
    return null;
  },
};