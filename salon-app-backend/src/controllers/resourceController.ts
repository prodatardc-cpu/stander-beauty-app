import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Appointment, Attendance, Commission, Product, Sale, SaleItem, Service, Staff, StockMovement, User } from '../models';
import type { AuthRequest } from '../middleware/authMiddleware';
import { stockService } from '../services/stockService';
import { isOptionalText, isText, isUuid } from '../utils/validators';

const routeId = (req: Request) => {
  const id = req.params.id;
  return typeof id === 'string' ? id : undefined;
};

const textLimits = { name: 120, phone: 40, position: 120, category: 80, description: 2000 };

const isPhoto = (value: unknown) =>
  typeof value === 'string' && value.startsWith('data:image/jpeg;base64,') && value.length <= 90000;

// A product picture: a web address, or a photo compressed by the web app (same limit as staff photos).
const isProductImage = (value: unknown) => typeof value === 'string' &&
  (isPhoto(value) || (value.length <= 2000 && /^https?:\/\/\S+$/i.test(value.trim())));

const isRate = (value: unknown) => typeof value !== 'boolean' && value !== null && value !== '' &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;

// A non-negative amount that fits the column (DECIMAL(10, 2) for prices, (12, 2) for salaries).
const isAmount = (value: unknown, max = 99_999_999) => typeof value !== 'boolean' && value !== null && value !== '' &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= max;
const isOptionalAmount = (value: unknown) => value === undefined || value === null || isAmount(value);

// Validates the fields of a staff member; `partial` for an update. Returns an error message or null.
const staffFieldsError = (body: Record<string, unknown>, partial: boolean) => {
  const allowed = ['name', 'phone', 'position', 'commissionRate', 'payType', 'monthlySalary', 'photoUrl', 'status'];
  if (partial && Object.keys(body).some((field) => !allowed.includes(field))) {
    return 'Unknown staff fields';
  }
  for (const field of ['name', 'phone', 'position'] as const) {
    if ((!partial || body[field] !== undefined) && !isText(body[field], textLimits[field])) return 'Name, phone and position are required';
  }
  if (body.commissionRate !== undefined && !isRate(body.commissionRate)) return 'Commission rate must be between 0 and 100';
  if (body.payType !== undefined && !['commission', 'fixed'].includes(String(body.payType))) return 'Pay type must be commission or fixed';
  if (body.monthlySalary !== undefined && !isAmount(body.monthlySalary, 9_999_999_999)) return 'Monthly salary must be a positive amount';
  if (body.photoUrl != null && body.photoUrl !== '' && !isPhoto(body.photoUrl)) return 'Photo must be a compressed JPEG smaller than 90 KB';
  if (body.status !== undefined && !['active', 'inactive'].includes(String(body.status))) return 'Invalid status';
  return null;
};

const serviceFieldsError = (body: Record<string, unknown>, partial: boolean) => {
  const allowed = ['name', 'description', 'price', 'duration', 'category', 'status', 'audience', 'womenPrice', 'menPrice'];
  if (partial && Object.keys(body).some((field) => !allowed.includes(field))) {
    return 'Unknown service fields';
  }
  if ((!partial || body.name !== undefined) && !isText(body.name, textLimits.name)) return 'Name, category, a valid price and duration are required';
  if ((!partial || body.category !== undefined) && !isText(body.category, textLimits.category)) return 'Name, category, a valid price and duration are required';
  if ((!partial || body.price !== undefined) && (typeof body.price === 'boolean' || !Number.isFinite(Number(body.price)) || Number(body.price) < 0 || Number(body.price) > 99_999_999)) {
    return 'Name, category, a valid price and duration are required';
  }
  if ((!partial || body.duration !== undefined) && (!Number.isInteger(Number(body.duration)) || Number(body.duration) <= 0 || Number(body.duration) > 24 * 60)) {
    return 'Name, category, a valid price and duration are required';
  }
  if (!isOptionalText(body.description, textLimits.description)) return 'Description is too long';
  if (body.status !== undefined && !['active', 'inactive'].includes(String(body.status))) return 'Invalid status';
  if (body.audience !== undefined && !['women', 'men', 'unisex'].includes(String(body.audience))) return 'Audience must be women, men or unisex';
  if (!isOptionalAmount(body.womenPrice) || !isOptionalAmount(body.menPrice)) return 'Name, category, a valid price and duration are required';
  return null;
};

// Women/men prices: a number, or null to fall back on the base price.
const audiencePrices = (body: Record<string, unknown>) => Object.fromEntries((['womenPrice', 'menPrice'] as const)
  .filter((field) => body[field] !== undefined)
  .map((field) => [field, body[field] === null ? null : Number(body[field])]));

const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

// Only the listed fields are written (no mass assignment of ids, timestamps or archive markers).
const pick = (body: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, trimmed(body[field])]));

export const resourceController = {
  listStaff: async (req: Request, res: Response) => {
    try {
      // Archived members are hidden unless asked for (e.g. to label past sales).
      const where = req.query.includeArchived === 'true' ? {} : { archivedAt: null };
      res.json(await Staff.findAll({ where, order: [['name', 'ASC']] }));
    } catch {
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  },

  createStaff: async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const invalid = staffFieldsError(body, false);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const staff = await Staff.create({
        ...pick(body, ['name', 'phone', 'position', 'commissionRate', 'payType', 'monthlySalary']),
        photoUrl: body.photoUrl || null,
      });
      res.status(201).json(staff);
    } catch {
      res.status(400).json({ error: 'Failed to create staff member' });
    }
  },

  updateStaff: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid staff ID' });
    const body = req.body ?? {};
    const invalid = staffFieldsError(body, true);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const staff = await Staff.findByPk(id);
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });
      await staff.update({
        ...pick(body, ['name', 'phone', 'position', 'commissionRate', 'payType', 'monthlySalary', 'status']),
        ...(body.photoUrl !== undefined && { photoUrl: body.photoUrl || null }),
      });
      res.json(staff);
    } catch {
      res.status(400).json({ error: 'Failed to update staff member' });
    }
  },

  // Never destroys sales, commissions or attendance: a member with history is archived (inactive,
  // hidden from lists, kept in reports). Everything happens in one transaction.
  deleteStaff: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid staff ID' });
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        // Sales lock the staff row too, so nothing can be attributed to this member meanwhile.
        const staff = await Staff.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!staff) return null;

        // Team accounts linked to this member lose access (sessions revoked) but are kept for the audit trail.
        const accounts = await User.findAll({ where: { staffId: id, role: { [Op.ne]: 'admin' } }, transaction, lock: transaction.LOCK.UPDATE });
        for (const account of accounts) {
          await account.update({ status: 'inactive', authVersion: account.authVersion + 1 }, { transaction });
        }

        // Evaluated one after the other on the transaction's connection.
        const history = [
          await Sale.count({ where: { staffId: id }, transaction }),
          await Commission.count({ where: { staffId: id }, transaction }),
          await Attendance.count({ where: { staffId: id }, transaction }),
          await Appointment.count({ where: { staffId: id }, transaction }),
        ];
        if (history.every((count) => count === 0)) {
          await staff.destroy({ transaction });
          return 'deleted' as const;
        }
        await staff.update({ status: 'inactive', archivedAt: staff.archivedAt ?? new Date() }, { transaction });
        return 'archived' as const;
      });
      if (!outcome) return res.status(404).json({ error: 'Staff member not found' });

      res.json({
        success: true,
        outcome,
        message: outcome === 'deleted' ? 'Staff member deleted (no history)' : 'Staff member archived; sales, commissions and attendance are kept',
      });
    } catch {
      res.status(500).json({ error: 'Failed to delete staff member' });
    }
  },

  restoreStaff: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid staff ID' });
    try {
      const staff = await Staff.findByPk(id);
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });
      // Comes back inactive: the administrator reactivates the member explicitly.
      if (staff.archivedAt) await staff.update({ archivedAt: null });
      res.json(staff);
    } catch {
      res.status(500).json({ error: 'Failed to restore staff member' });
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
    const { name, sku, priceBuy, priceSell, quantityStock = 0, category, imageUrl, lowStockThreshold = 5, description } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || typeof sku !== 'string' || !sku.trim() || typeof category !== 'string' || !category.trim() ||
        !Number.isFinite(Number(priceBuy)) || Number(priceBuy) < 0 || !Number.isFinite(Number(priceSell)) || Number(priceSell) < 0 ||
        !Number.isInteger(Number(quantityStock)) || Number(quantityStock) < 0 || !Number.isInteger(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0 ||
        (imageUrl != null && imageUrl !== '' && !isProductImage(imageUrl)) ||
        !isOptionalText(description, textLimits.description)) {
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
          description: typeof description === 'string' && description.trim() ? description.trim() : null,
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
      const allowed = ['name', 'sku', 'priceBuy', 'priceSell', 'category', 'imageUrl', 'lowStockThreshold', 'status', 'description'];
      if (Object.keys(body).some((field) => !allowed.includes(field)) ||
          (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) ||
          (body.sku !== undefined && (typeof body.sku !== 'string' || !body.sku.trim())) ||
          (body.category !== undefined && (typeof body.category !== 'string' || !body.category.trim())) ||
          (body.priceBuy !== undefined && (!Number.isFinite(Number(body.priceBuy)) || Number(body.priceBuy) < 0)) ||
          (body.priceSell !== undefined && (!Number.isFinite(Number(body.priceSell)) || Number(body.priceSell) < 0)) ||
          (body.lowStockThreshold !== undefined && (!Number.isInteger(Number(body.lowStockThreshold)) || Number(body.lowStockThreshold) < 0)) ||
          (body.status !== undefined && !['active', 'inactive'].includes(body.status)) ||
          !isOptionalText(body.description, textLimits.description) ||
          (body.imageUrl !== undefined && body.imageUrl !== null && body.imageUrl !== '' && !isProductImage(body.imageUrl))) {
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
    const body = req.body ?? {};
    const invalid = serviceFieldsError(body, false);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const service = await Service.create({
        ...pick(body, ['name', 'description', 'price', 'duration', 'category', 'audience']),
        ...audiencePrices(body),
      });
      res.status(201).json(service);
    } catch {
      res.status(400).json({ error: 'Failed to create service' });
    }
  },

  updateService: async (req: Request, res: Response) => {
    const id = routeId(req);
    if (!id) return res.status(400).json({ error: 'Invalid service ID' });
    const body = req.body ?? {};
    const invalid = serviceFieldsError(body, true);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const service = await Service.findByPk(id);
      if (!service) return res.status(404).json({ error: 'Service not found' });
      await service.update({
        ...pick(body, ['name', 'description', 'price', 'duration', 'category', 'status', 'audience']),
        ...audiencePrices(body),
      });
      res.json(service);
    } catch {
      res.status(400).json({ error: 'Failed to update service' });
    }
  },
};