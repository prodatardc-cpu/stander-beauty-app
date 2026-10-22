import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

// Journal of the changes broadcast in real time (services/realtime.ts), so that a device that was
// offline can catch up (GET /activity). Written after each change is committed; never updated.
// audience: who may read it ('everyone', 'history' = cash journal readers, 'payroll' = pay readers
// and the member `staffId`).
export class ActivityEvent extends Model {
  declare id: string;
  declare type: string;
  declare entity: string;
  declare entityId: string | null;
  declare at: Date;
  declare actorEmail: string | null;
  declare actorRole: string | null;
  declare summary: string;
  declare currency: string | null;
  declare amount: number | string | null;
  declare day: string | null;
  declare audience: 'everyone' | 'history' | 'payroll';
  declare staffId: string | null;
}

ActivityEvent.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    type: { type: DataTypes.STRING(60), allowNull: false },
    entity: { type: DataTypes.STRING(40), allowNull: false },
    entityId: { type: DataTypes.STRING(64), allowNull: true },
    at: { type: DataTypes.DATE, allowNull: false },
    actorEmail: { type: DataTypes.STRING(254), allowNull: true },
    actorRole: { type: DataTypes.STRING(20), allowNull: true },
    summary: { type: DataTypes.STRING(255), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: true },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    day: { type: DataTypes.STRING(10), allowNull: true },
    audience: { type: DataTypes.STRING(10), allowNull: false },
    staffId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'ActivityEvent', tableName: 'activity_events', timestamps: false }
);
