import type { Request, Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { sequelize } from '../config/database';
import { hasRole, policy } from '../config/permissions';
import type { AuthRequest } from '../middleware/authMiddleware';
import { Appointment, Client, Sale } from '../models';
import { isOptionalText, isText, isUuid } from '../utils/validators';

const limits = { name: 120, phone: 40, notes: 2000, search: 100, loyaltyPoints: 1_000_000 };

// Archived clients are hidden from lists unless asked for (e.g. to label past sales).
const visibleClients = (req: Request): WhereOptions =>
  req.query.includeArchived === 'true' ? {} : { archivedAt: null };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

const fieldsError = (body: Record<string, unknown>, partial: boolean) => {
  const { name, phone, notes } = body;
  if ((!partial || name !== undefined) && !isText(name, limits.name)) return `Name is required (${limits.name} characters max)`;
  if ((!partial || phone !== undefined) && !isText(phone, limits.phone)) return `A phone number is required (${limits.phone} characters max)`;
  if (!isOptionalText(notes, limits.notes)) return `Notes are limited to ${limits.notes} characters`;
  return null;
};

const phoneConflict = async (phone: string, exceptId?: string) => {
  const existing = await Client.findOne({ where: { phone, ...(exceptId && { id: { [Op.ne]: exceptId } }) } });
  if (!existing) return null;
  return existing.archivedAt
    ? { status: 409, error: 'Phone number belongs to an archived client' }
    : { status: 400, error: 'Phone number already exists' };
};

export const clientController = {
  getAll: async (req: Request, res: Response) => {
    try {
      const clients = await Client.findAll({ where: visibleClients(req) });
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  },

  searchClient: async (req: Request, res: Response) => {
    const { q, name, phone } = req.query;
    if ([q, name, phone].some((value) => value !== undefined && (typeof value !== 'string' || value.length > limits.search))) {
      return res.status(400).json({ error: 'Invalid search' });
    }
    try {
      const conditions: WhereOptions[] = [visibleClients(req)];

      // `q` matches the name or the phone number (what the web app sends).
      if (typeof q === 'string' && q.trim()) {
        const pattern = `%${escapeLike(q.trim())}%`;
        conditions.push({ [Op.or]: [{ name: { [Op.iLike]: pattern } }, { phone: { [Op.iLike]: pattern } }] });
      }
      if (typeof name === 'string' && name.trim()) {
        conditions.push({ name: { [Op.iLike]: `%${escapeLike(name.trim())}%` } });
      }
      if (typeof phone === 'string' && phone.trim()) {
        conditions.push({ phone: phone.trim() });
      }

      const clients = await Client.findAll({ where: { [Op.and]: conditions } });
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: 'Search failed' });
    }
  },

  getById: async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!isUuid(id)) {
        return res.status(400).json({ error: 'Invalid client ID' });
      }
      const client = await Client.findByPk(id);

      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch client' });
    }
  },

  create: async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const invalid = fieldsError(body, false);
    if (invalid) return res.status(400).json({ error: invalid });
    try {
      const phone = String(body.phone).trim();
      const conflict = await phoneConflict(phone);
      if (conflict) {
        return res.status(conflict.status).json({ error: conflict.error });
      }

      const client = await Client.create({
        name: String(body.name).trim(),
        phone,
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        registrationDate: new Date(),
      });

      res.status(201).json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create client' });
    }
  },

  update: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    const body = req.body ?? {};
    const invalid = fieldsError(body, true);
    if (invalid) return res.status(400).json({ error: invalid });
    const { name, phone, notes, loyaltyPoints } = body;
    if (loyaltyPoints !== undefined) {
      if (!hasRole(policy.adjustLoyaltyPoints, req.user?.role)) return res.status(403).json({ error: 'Access denied' });
      if (!Number.isInteger(loyaltyPoints) || loyaltyPoints < 0 || loyaltyPoints > limits.loyaltyPoints) {
        return res.status(400).json({ error: 'Loyalty points must be a positive integer' });
      }
    }
    try {
      const client = await Client.findByPk(id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      if (typeof phone === 'string') {
        const conflict = await phoneConflict(phone.trim(), id);
        if (conflict) return res.status(conflict.status).json({ error: conflict.error });
      }

      await client.update({
        name: typeof name === 'string' ? name.trim() : client.name,
        phone: typeof phone === 'string' ? phone.trim() : client.phone,
        notes: notes === undefined ? client.notes : typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        loyaltyPoints: loyaltyPoints ?? client.loyaltyPoints,
      });

      res.json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update client' });
    }
  },

  // Never destroys financial history: a client with sales or appointments is archived (hidden from
  // lists, kept in reports); only a client without any history is deleted, inside one transaction.
  remove: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    try {
      const outcome = await sequelize.transaction(async (transaction) => {
        // Sales lock the client row too, so no sale can be recorded for it while this runs.
        const client = await Client.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!client) return null;
        const sales = await Sale.count({ where: { clientId: id }, transaction });
        const appointments = await Appointment.count({ where: { clientId: id }, transaction });
        if (sales === 0 && appointments === 0) {
          await client.destroy({ transaction });
          return 'deleted' as const;
        }
        if (!client.archivedAt) await client.update({ archivedAt: new Date() }, { transaction });
        return 'archived' as const;
      });
      if (!outcome) return res.status(404).json({ error: 'Client not found' });
      res.json({
        success: true,
        outcome,
        message: outcome === 'deleted' ? 'Client deleted (no history)' : 'Client archived; sales and appointments are kept',
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete client' });
    }
  },

  restore: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }
    try {
      const client = await Client.findByPk(id);
      if (!client) return res.status(404).json({ error: 'Client not found' });
      if (client.archivedAt) await client.update({ archivedAt: null });
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to restore client' });
    }
  },
};
