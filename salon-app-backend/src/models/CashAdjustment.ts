import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

// A cash entry or withdrawal that is neither a sale, an expense nor a payout (float added to the
// drawer, money taken to the bank…). Sales, expenses and payouts feed the cash journal by themselves.
export class CashAdjustment extends Model {
  declare id: string;
  declare direction: 'in' | 'out';
  declare amount: number | string;
  declare currency: Currency;
  declare paymentMethod: string;
  declare reason: string;
  declare userId: string | null;
  declare createdAt: Date;
}

CashAdjustment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    direction: { type: DataTypes.STRING(3), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    paymentMethod: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'cash' },
    reason: { type: DataTypes.STRING(255), allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'CashAdjustment', tableName: 'cash_adjustments' }
);
