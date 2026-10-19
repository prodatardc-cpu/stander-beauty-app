import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

// Money handed to a team member: an advance on future earnings or a payment of what is due.
// Each payout keeps its currency; payouts are never updated nor deleted.
export class StaffPayout extends Model {
  declare id: string;
  declare staffId: string;
  declare kind: 'advance' | 'payment';
  declare amount: number | string;
  declare currency: Currency;
  declare paymentMethod: string;
  declare note: string | null;
  declare idempotencyKey: string;
  declare paidByUserId: string | null;
  declare createdAt: Date;
}

StaffPayout.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    staffId: { type: DataTypes.UUID, allowNull: false },
    kind: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    paymentMethod: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'cash' },
    note: { type: DataTypes.STRING(255), allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    paidByUserId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'StaffPayout', tableName: 'staff_payouts' }
);
