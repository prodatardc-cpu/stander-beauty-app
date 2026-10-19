import type { Request, Response } from 'express';
import { Op } from 'sequelize';
import { settingsService } from '../services/settingsService';
import { Appointment, type AppointmentStatus } from '../models/Appointment';
import { Client } from '../models/Client';
import { Service } from '../models/Service';
import { Staff } from '../models/Staff';
import { isOptionalText, isUuid } from '../utils/validators';

const statuses: AppointmentStatus[] = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
const maxNotesLength = 1000;

const isDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const activeStatuses: AppointmentStatus[] = ['scheduled', 'confirmed'];

// Another planned appointment of the same member overlapping [start, start + duration).
const findConflict = async (staffId: string, start: Date, durationMinutes: number, excludeId?: string) => {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const candidates = await Appointment.findAll({
    where: {
      staffId,
      status: activeStatuses,
      scheduledAt: { [Op.lt]: end, [Op.gt]: new Date(start.getTime() - 24 * 60 * 60_000) },
      ...(excludeId && { id: { [Op.ne]: excludeId } }),
    },
    include: [{ model: Service, attributes: ['duration', 'name'] }, { model: Client, attributes: ['name'] }],
  });
  return candidates.find((entry) => {
    const otherDuration = Number((entry.get('Service') as Service | undefined)?.duration ?? 30);
    return new Date(entry.scheduledAt.getTime() + otherDuration * 60_000) > start;
  }) ?? null;
};

const conflictResponse = (res: Response, conflict: Appointment) => res.status(409).json({
  error: 'Staff member already booked at this time',
  conflict: {
    id: conflict.id, scheduledAt: conflict.scheduledAt,
    service: (conflict.get('Service') as Service | undefined)?.name ?? null,
    client: (conflict.get('Client') as Client | undefined)?.name ?? null,
  },
});

// The client must not be archived, the staff member must be active and the service offered.
const referencesError = async ({ clientId, staffId, serviceId }: { clientId?: string; staffId?: string; serviceId?: string }) => {
  if (clientId) {
    const client = await Client.findByPk(clientId);
    if (!client || client.archivedAt) return 'Client not found';
  }
  if (staffId) {
    const staff = await Staff.findByPk(staffId);
    if (!staff || staff.status !== 'active' || staff.archivedAt) return 'Active staff member not found';
  }
  if (serviceId) {
    const service = await Service.findByPk(serviceId);
    if (!service || service.status !== 'active') return 'Active service not found';
  }
  return null;
};

export const appointmentController = {
  list: async (_req: Request, res: Response) => {
    try {
      const appointments = await Appointment.findAll({
        include: [
          { model: Client, attributes: ['id', 'name', 'phone'] },
          { model: Staff, attributes: ['id', 'name'] },
          { model: Service, attributes: ['id', 'name', 'duration', 'price', 'audience', 'womenPrice', 'menPrice'] },
        ],
        order: [['scheduledAt', 'ASC']],
      });
      res.json(appointments);
    } catch {
      res.status(500).json({ error: 'Failed to fetch appointments' });
    }
  },

  create: async (req: Request, res: Response) => {
    const { clientId, staffId, serviceId, scheduledAt, notes, allowOverlap } = req.body ?? {};
    if (![clientId, staffId, serviceId].every(isUuid) || !isDate(scheduledAt) || !isOptionalText(notes, maxNotesLength) ||
        (allowOverlap !== undefined && typeof allowOverlap !== 'boolean')) {
      return res.status(400).json({ error: 'Client, staff, service and a valid date are required' });
    }
    try {
      const invalidReference = await referencesError({ clientId, staffId, serviceId });
      if (invalidReference) return res.status(400).json({ error: invalidReference });
      const service = (await Service.findByPk(serviceId))!;
      if (!allowOverlap) {
        const conflict = await findConflict(staffId, new Date(scheduledAt), Number(service.duration));
        if (conflict) return conflictResponse(res, conflict);
      }
      // The price is kept as booked: a later change of the service's price does not alter it.
      const { baseCurrency } = await settingsService.get();
      const appointment = await Appointment.create({
        clientId,
        staffId,
        serviceId,
        scheduledAt: new Date(scheduledAt),
        notes: typeof notes === 'string' ? notes : undefined,
        price: service.price,
        currency: baseCurrency,
      });
      res.status(201).json(appointment);
    } catch {
      res.status(400).json({ error: 'Failed to create appointment; check the selected records' });
    }
  },

  // Only the schedule, the status, the notes, the staff member and the service can change.
  update: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid appointment ID' });
    const { status, scheduledAt, notes, staffId, serviceId, allowOverlap } = req.body ?? {};
    const allowed = ['status', 'scheduledAt', 'notes', 'staffId', 'serviceId', 'allowOverlap'];
    if (Object.keys(req.body ?? {}).some((field) => !allowed.includes(field)) ||
        (status !== undefined && !statuses.includes(status)) ||
        (scheduledAt !== undefined && !isDate(scheduledAt)) ||
        !isOptionalText(notes, maxNotesLength) ||
        (staffId !== undefined && !isUuid(staffId)) ||
        (serviceId !== undefined && !isUuid(serviceId))) {
      return res.status(400).json({ error: 'Invalid appointment fields' });
    }
    try {
      const appointment = await Appointment.findByPk(id);
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
      const invalidReference = await referencesError({ staffId, serviceId });
      if (invalidReference) return res.status(400).json({ error: invalidReference });
      const service = (await Service.findByPk(serviceId ?? appointment.serviceId))!;
      const nextStatus = status ?? appointment.status;
      if (!allowOverlap && activeStatuses.includes(nextStatus) && (scheduledAt !== undefined || staffId !== undefined || serviceId !== undefined)) {
        const conflict = await findConflict(staffId ?? appointment.staffId, scheduledAt !== undefined ? new Date(scheduledAt) : appointment.scheduledAt,
          Number(service.duration), appointment.id);
        if (conflict) return conflictResponse(res, conflict);
      }
      // Choosing another service takes its current price; otherwise the booked price stays.
      const priceChange = serviceId !== undefined && serviceId !== appointment.serviceId
        ? { price: service.price, currency: (await settingsService.get()).baseCurrency }
        : {};
      await appointment.update({
        ...priceChange,
        ...(status !== undefined && { status }),
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(notes !== undefined && { notes }),
        ...(staffId !== undefined && { staffId }),
        ...(serviceId !== undefined && { serviceId }),
      });
      res.json(appointment);
    } catch {
      res.status(400).json({ error: 'Failed to update appointment' });
    }
  },

  remove: async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid appointment ID' });
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
