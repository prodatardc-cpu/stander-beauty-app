import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

export class Expense extends Model {
  declare id: string;
  declare description: string;
  declare category: string;
  declare amount: number;
  declare currency: Currency;
  declare paymentMethod: string;
  declare createdAt: Date;
  declare createdByUserId: string | null;
  declare cancelledAt: Date | null;
  declare cancelledByUserId: string | null;
  declare cancelReason: string | null;
}

Expense.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    description: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
    // An expense entered by mistake is cancelled, never erased.
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelledByUserId: { type: DataTypes.UUID, allowNull: true },
    cancelReason: { type: DataTypes.STRING(255), allowNull: true },
  },
  { sequelize, modelName: 'Expense', tableName: 'expenses' }
);