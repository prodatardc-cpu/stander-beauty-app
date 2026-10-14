import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export class Appointment extends Model {
  declare id: string;
  declare clientId: string;
  declare staffId: string;
  declare serviceId: string;
  declare scheduledAt: Date;
  declare status: AppointmentStatus;
  declare notes?: string;
}

Appointment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clientId: { type: DataTypes.UUID, allowNull: false },
    staffId: { type: DataTypes.UUID, allowNull: false },
    serviceId: { type: DataTypes.UUID, allowNull: false },
    scheduledAt: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'),
      defaultValue: 'scheduled',
    },
    notes: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Appointment',
    tableName: 'appointments',
  }
);