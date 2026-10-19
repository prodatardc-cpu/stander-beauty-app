import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

export class Sale extends Model {
  declare id: string;
  declare clientId: string | null;
  declare clientName: string | null;
  declare staffId: string | null;
  declare saleDate: Date;
  declare totalAmount: number;
  declare currency: 'USD' | 'CDF' | null;
  declare exchangeRateUsed: number | null;
  declare baseCurrency: Currency | null;
  declare baseAmount: number | string | null;
  declare paymentMethod: string;
  declare status: 'completed' | 'refunded';
  declare discountAmount?: number;
  declare amountPaid: number;
  declare remainingAmount: number;
  // Printed on the receipt; assigned by the database (sequence), in order of creation.
  declare receiptNumber: number | string;
  declare createdByUserId: string | null;
  declare cancelledAt: Date | null;
  declare cancelledByUserId: string | null;
  declare cancelReason: string | null;
  declare createdAt: Date;
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
    // The total in the salon's base currency at the time of the sale (added to the client's total).
    baseCurrency: {
      type: DataTypes.STRING(3),
      allowNull: true,
    },
    baseAmount: {
      type: DataTypes.DECIMAL(14, 2),
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
    // Default nextval('sales_receipt_number_seq'), set by migration 007.
    receiptNumber: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // A cancelled sale keeps its lines and payments; these say when, by whom and why.
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelledByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    cancelReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Sale',
    tableName: 'sales',
  }
);