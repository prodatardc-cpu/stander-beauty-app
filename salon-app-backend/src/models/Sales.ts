import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Sale extends Model {
  declare id: string;
  declare clientId: string | null;
  declare clientName: string | null;
  declare staffId: string | null;
  declare saleDate: Date;
  declare totalAmount: number;
  declare currency: 'USD' | 'CDF' | null;
  declare exchangeRateUsed: number | null;
  declare paymentMethod: string;
  declare status: 'completed' | 'refunded';
  declare discountAmount?: number;
  declare amountPaid: number;
  declare remainingAmount: number;
}

Sale.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clientId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    staffId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    saleDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: true,
    },
    exchangeRateUsed: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
    },
    paymentMethod: {
      type: DataTypes.ENUM('cash', 'momo', 'card', 'transfer', 'other'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('completed', 'refunded'),
      defaultValue: 'completed',
    },
    discountAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    amountPaid: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    remainingAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
  },
  {
    sequelize,
    modelName: 'Sale',
    tableName: 'sales',
  }
);