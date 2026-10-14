import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Appointment, Attendance, Commission, Product, Sale, SaleItem, Service, Staff, StockMovement, User } from '../models';
import type { AuthRequest } from '../middleware/authMiddleware';
import { stockService } from '../services/stockService';

const routeId = (req: Request) => {
  const id = req.params.id;
  return typeof id === 'string' ? id : undefined;
};

export const resourceController = {
  listStaff: async (_req: Request, res: Response) => {
    try {
      res.json(await Staff.findAll({ order: [['name', 'ASC']] }));
    } catch {
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  },

  createStaff: async (req: Request, res: Response) => {
    const { name, phone, position, commissionRate, photoUrl } = req.body;
    if (typeof name !== 'string' || typeof phone !== 'string' || typeof position !== 'string') {
      return res.status(400).json({ error: 'Name, phone and position are required' });
    }
    if (photoUrl != null && (typeof photoUrl !== 'string' || !photoUrl.startsWith('data:image/jpeg;base64,') || photoUrl.length > 90000)) {
      return res.status(400).json({ error: 'Photo must be a compressed JPEG smaller than 90 KB' });
    }
    try {
      const staff = await Staff.create({ name: name.trim(), phone: phone.trim(), position: position.trim(), commissionRate, photoUrl: photoUrl || null });
      res.status(201).json(staff);
    } catch {
      res.status(400).json({ error: 'Failed to create staff member' });
    }
  },

  updateStaff: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid staff ID' });
    try {
      const staff = await Staff.findByPk(id);
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });
      await staff.update(req.body);
      res.json(staff);
    } catch {
      res.status(400).json({ error: 'Failed to update staff member' });
    }
  },

  deleteStaff: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid staff ID' });
    try {
      const staff = await Staff.findByPk(id);
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });

      const sales = await Sale.findAll({ where: { staffId: id } });
      const saleIds = sales.map((sale) => sale.id);

      if (saleIds.length > 0) {
        const saleItems = await SaleItem.findAll({ where: { saleId: saleIds } });
        const saleItemIds = saleItems.map((item) => item.id);

        if (saleItemIds.length > 0) {
          await Commission.destroy({ where: { saleItemId: saleItemIds } });
        }

        await SaleItem.destroy({ where: { saleId: saleIds } });
      }

      await Commission.destroy({ where: { staffId: id } });
      await Attendance.destroy({ where: { staffId: id } });
      await Sale.destroy({ where: { staffId: id } });
      await Appointment.destroy({ where: { staffId: id } });
      await User.destroy({ where: { staffId: id } });
      await staff.destroy();

      res.json({ success: true, message: 'Staff member deleted successfully' });
    } catch {
      res.status(500).json({ error: 'Failed to delete staff member' });
    }
  },

  listProducts: async (_req: Request, res: Response) => {
    try {
      res.json(await Product.findAll({ order: [['name', 'ASC']] }));
    } catch {
      res.status(500).json({ error: 'Failed to fetch products' });
    }
  },

  createProduct: async (req: Request, res: Response) => {
    const { name, sku, priceBuy, priceSell, quantityStock = 0, category, imageUrl, lowStockThreshold = 5 } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || typeof sku !== 'string' || !sku.trim() || typeof category !== 'string' || !category.trim() ||
        !Number.isFinite(Number(priceBuy)) || Number(priceBuy) < 0 || !Number.isFinite(Number(priceSell)) || Number(priceSell) < 0 ||
        !Number.isInteger(Number(quantityStock)) || Number(quantityStock) < 0 || !Number.isInteger(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0 ||
        (imageUrl != null && imageUrl !== '' && (typeof imageUrl !== 'string' || imageUrl.length > 255 || !/^https?:\/\/\S+$/i.test(imageUrl.trim())))) {
      return res.status(400).json({ error: 'Name, SKU, category and valid prices are required' });
    }
    try {
      const skuExists = await Product.findOne({ where: sequelize.where(sequelize.fn('lower', sequelize.col('sku')), sku.trim().toLowerCase()) });
      if (skuExists) return res.status(409).json({ error: 'SKU already exists' });
      const product = await sequelize.transaction(async (transaction) => {
        const created = await Product.create({
          name: name.trim(), sku: sku.trim().toUpperCase(), priceBuy: Number(priceBuy), priceSell: Number(priceSell),
          quantityStock: Number(quantityStock), quantityReceived: Number(quantityStock), lowStockThreshold: Number(lowStockThreshold),
          category: category.trim(), imageUrl: imageUrl?.trim() || null, status: 'active',
        }, { transaction });
        if (Number(quantityStock) > 0) {
          await stockService.record(created.id, 'in', 'initial', Number(quantityStock), Number(quantityStock), { userId: (req as AuthRequest).user?.id, transaction });
        }
        return created;
      });
      res.status(201).json(product);
    } catch {
      res.status(400).json({ error: 'Failed to create product; check that the SKU is unique' });
    }
  },

  updateProduct: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid product ID' });
    try {
      const body = req.body ?? {};
      const allowed = ['name', 'sku', 'priceBuy', 'priceSell', 'category', 'imageUrl', 'lowStockThreshold', 'status'];
      if (Object.keys(body).some((field) => !allowed.includes(field)) ||
          (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) ||
          (body.sku !== undefined && (typeof body.sku !== 'string' || !body.sku.trim())) ||
          (body.category !== undefined && (typeof body.category !== 'string' || !body.category.trim())) ||
          (body.priceBuy !== undefined && (!Number.isFinite(Number(body.priceBuy)) || Number(body.priceBuy) < 0)) ||
          (body.priceSell !== undefined && (!Number.isFinite(Number(body.priceSell)) || Number(body.priceSell) < 0)) ||
          (body.lowStockThreshold !== undefined && (!Number.isInteger(Number(body.lowStockThreshold)) || Number(body.lowStockThreshold) < 0)) ||
          (body.status !== undefined && !['active', 'inactive'].includes(body.status)) ||
          (body.imageUrl !== undefined && body.imageUrl !== null && body.imageUrl !== '' && (typeof body.imageUrl !== 'string' || body.imageUrl.length > 255 || !/^https?:\/\/\S+$/i.test(body.imageUrl.trim())))) {
        return res.status(400).json({ error: 'Invalid product fields' });
      }
      const product = await Product.findByPk(id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (typeof body.sku === 'string') {
        const duplicate = await Product.findOne({ where: { [Op.and]: [sequelize.where(sequelize.fn('lower', sequelize.col('sku')), body.sku.trim().toLowerCase()), { id: { [Op.ne]: id } }] } });
        if (duplicate) return res.status(409).json({ error: 'SKU already exists' });
      }
      await product.update(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? (key === 'sku' ? value.trim().toUpperCase() : value.trim()) : value])));
      res.json(product);
    } catch {
      res.status(400).json({ error: 'Failed to update product' });
    }
  },

  receiveProductStock: async (req: AuthRequest, res: Response) => {
    const id = routeId(req);
    const quantity = Number(req.body?.quantity);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 255) : null;
    if (!id || !Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: 'A product ID and positive integer quantity are required' });
    try {
      const product = await sequelize.transaction((transaction) => stockService.put(id, quantity, 'reception', { countAsReceived: true, note, userId: req.user?.id, transaction }));
      if (!product) return res.status(404).json({ error: 'Product not found' });
      return res.json(product);
    } catch {
      return res.status(400).json({ error: 'Failed to receive product stock' });
    }
  },

  adjustProductStock: async (req: AuthRequest, res: Response) => {
    const id = routeId(req);
    const counted = Number(req.body?.quantity);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 255) : '';
    if (!id || !Number.isInteger(counted) || counted < 0 || !note) return res.status(400).json({ error: 'A product ID, non-negative count and adjustment reason are required' });
    try {
      const product = await sequelize.transaction(async (transaction) => {
        const current = await Product.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!current) return null;
        const difference = counted - Number(current.quantityStock);
        if (difference === 0) return current;
        return difference > 0
          ? stockService.put(id, difference, 'adjustment', { note, userId: req.user?.id, transaction })
          : stockService.take(id, -difference, 'adjustment', { note, userId: req.user?.id, transaction });
      });
      if (!product) return res.status(404).json({ error: 'Product not found' });
      return res.json(product);
    } catch {
      return res.status(400).json({ error: 'Failed to adjust product stock' });
    }
  },

  listProductMovements: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid product ID' });
    try {
      const [movements, users] = await Promise.all([
        StockMovement.findAll({ where: { productId: id }, order: [['createdAt', 'DESC']], limit: 200 }),
        User.findAll({ attributes: ['id', 'email'] }),
      ]);
      const emails = new Map(users.map((user) => [user.id, user.email]));
      return res.json(movements.map((movement) => ({ ...movement.toJSON(), userEmail: movement.userId ? emails.get(movement.userId) ?? null : null })));
    } catch {
      return res.status(500).json({ error: 'Failed to fetch stock movements' });
    }
  },

  deleteProduct: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid product ID' });
    try {
      const product = await Product.findByPk(id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (await SaleItem.count({ where: { type: 'product', itemId: id } })) return res.status(409).json({ error: 'Product has sales history; deactivate it instead' });
      if (await StockMovement.count({ where: { productId: id } })) {
        await product.update({ status: 'inactive' });
        return res.json({ success: true, deactivated: true });
      }
      await sequelize.transaction(async (transaction) => {
        await product.destroy({ transaction });
      });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to delete product' });
    }
  },

  listServices: async (_req: Request, res: Response) => {
    try {
      res.json(await Service.findAll({ order: [['name', 'ASC']] }));
    } catch {
      res.status(500).json({ error: 'Failed to fetch services' });
    }
  },

  createService: async (req: Request, res: Response) => {
    const { name, description, price, duration, category } = req.body;
    if (typeof name !== 'string' || typeof category !== 'string' ||
        !Number.isFinite(Number(price)) || Number(price) < 0 ||
        !Number.isInteger(Number(duration)) || Number(duration) <= 0) {
      return res.status(400).json({ error: 'Name, category, a valid price and duration are required' });
    }
    try {
      const service = await Service.create({ name: name.trim(), description, price, duration, category: category.trim() });
      res.status(201).json(service);
    } catch {
      res.status(400).json({ error: 'Failed to create service' });
    }
  },

  updateService: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid service ID' });
    try {
      const service = await Service.findByPk(id);
      if (!service) return res.status(404).json({ error: 'Service not found' });
      await service.update(req.body);
      res.json(service);
    } catch {
      res.status(400).json({ error: 'Failed to update service' });
    }
  },
};