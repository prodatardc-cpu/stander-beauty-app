import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Expense extends Model {
  declare id: string;
  declare description: string;
  declare category: string;
  declare amount: number;
  declare paymentMethod: string;
  declare createdAt: Date;
}

Expense.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    description: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    paymentMethod: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize, modelName: 'Expense', tableName: 'expenses' }
);