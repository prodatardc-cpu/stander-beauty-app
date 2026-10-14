import type { Request, Response } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { Appointment, Commission, Client, Sale, SaleItem } from '../models';

export const clientController = {
  getAll: async (req: Request, res: Response) => {
    try {
      const clients = await Client.findAll();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  },

  searchClient: async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.query;
      const conditions: WhereOptions[] = [];

      if (typeof name === 'string' && name.trim()) {
        conditions.push({ name: { [Op.iLike]: `%${name.trim()}%` } });
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
      if (typeof id !== 'string') {
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
    try {
      const { name, phone, notes } = req.body;

      const existingClient = await Client.findOne({ where: { phone } });
      if (existingClient) {
        return res.status(400).json({ error: 'Phone number already exists' });
      }

      const client = await Client.create({
        name,
        phone,
        notes,
        registrationDate: new Date(),
      });

      res.status(201).json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create client' });
    }
  },

  update: async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Invalid client ID' });
      }
      const { name, phone, notes, loyaltyPoints } = req.body;

      const client = await Client.findByPk(id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }

      await client.update({
        name: name ?? client.name,
        phone: phone ?? client.phone,
        notes: notes ?? client.notes,
        loyaltyPoints: loyaltyPoints ?? client.loyaltyPoints,
      });

      res.json(client);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update client' });
    }
  },

  remove: async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') {
        return res.status(400).json({ error: 'Invalid client ID' });
      }

      const client = await Client.findByPk(id);
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }

      const sales = await Sale.findAll({ where: { clientId: id } });
      const saleIds = sales.map((sale) => sale.id);

      if (saleIds.length > 0) {
        const saleItems = await SaleItem.findAll({ where: { saleId: saleIds } });
        const saleItemIds = saleItems.map((item) => item.id);

        if (saleItemIds.length > 0) {
          await Commission.destroy({ where: { saleItemId: saleItemIds } });
        }

        await SaleItem.destroy({ where: { saleId: saleIds } });
      }

      await Sale.destroy({ where: { clientId: id } });
      await Appointment.destroy({ where: { clientId: id } });
      await client.destroy();

      res.json({ success: true, message: 'Client deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete client' });
    }
  },
};