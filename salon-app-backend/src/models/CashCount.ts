import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

// Cash actually counted in the drawer for a day and a currency, against the theoretical balance of
// that day's cash operations at the time of the count.
export class CashCount extends Model {
  declare id: string;
  declare day: string;
  declare currency: Currency;
  declare expectedAmount: number | string;
  declare countedAmount: number | string;
  declare note: string | null;
  declare userId: string | null;
  declare createdAt: Date;
}

CashCount.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    expectedAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    countedAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    note: { type: DataTypes.STRING(255), allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'CashCount', tableName: 'cash_counts' }
);
