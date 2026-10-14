import type { Request, Response } from 'express';
import { Appointment } from '../models/Appointment';
import { Client } from '../models/Client';
import { Service } from '../models/Service';
import { Staff } from '../models/Staff';

export const appointmentController = {
  list: async (_req: Request, res: Response) => {
    try {
      const appointments = await Appointment.findAll({
        include: [
          { model: Client, attributes: ['id', 'name', 'phone'] },
          { model: Staff, attributes: ['id', 'name'] },
          { model: Service, attributes: ['id', 'name', 'duration', 'price'] },
        ],
        order: [['scheduledAt', 'ASC']],
      });
      res.json(appointments);
    } catch {
      res.status(500).json({ error: 'Failed to fetch appointments' });
    }
  },

  create: async (req: Request, res: Response) => {
    const { clientId, staffId, serviceId, scheduledAt, notes } = req.body;
    if ([clientId, staffId, serviceId].some((value) => typeof value !== 'string') ||
        typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt))) {
      return res.status(400).json({ error: 'Client, staff, service and a valid date are required' });
    }
    try {
      const appointment = await Appointment.create({
        clientId,
        staffId,
        serviceId,
        scheduledAt: new Date(scheduledAt),
        notes: typeof notes === 'string' ? notes : undefined,
      });
      res.status(201).json(appointment);
    } catch {
      res.status(400).json({ error: 'Failed to create appointment; check the selected records' });
    }
  },

  update: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid appointment ID' });
    try {
      const appointment = await Appointment.findByPk(id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      const updates = { ...req.body };
      if (updates.scheduledAt !== undefined) {
        if (typeof updates.scheduledAt !== 'string' || Number.isNaN(Date.parse(updates.scheduledAt))) {
          return res.status(400).json({ error: 'Invalid appointment date' });
        }
        updates.scheduledAt = new Date(updates.scheduledAt);
      }
      await appointment.update(updates);
      res.json(appointment);
    } catch {
      res.status(400).json({ error: 'Failed to update appointment' });
    }
  },

  remove: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid appointment ID' });
    try {
      const appointment = await Appointment.findByPk(id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      await appointment.destroy();
      res.json({ success: true, message: 'Appointment deleted successfully' });
    } catch {
      res.status(500).json({ error: 'Failed to delete appointment' });
    }
  },
};