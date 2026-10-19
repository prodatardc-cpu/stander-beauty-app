import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

// Every amount received for a sale, in the sale's currency: the payment taken at the till ('sale')
// and each later settlement of the remaining debt ('debt'). Never updated nor deleted.
export class SalePayment extends Model {
  declare id: string;
  declare saleId: string;
  declare kind: 'sale' | 'debt';
  declare amount: number | string;
  declare currency: Currency;
  declare paymentMethod: string;
  declare idempotencyKey: string | null;
  declare userId: string | null;
  declare createdAt: Date;
}

SalePayment.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    saleId: { type: DataTypes.UUID, allowNull: false },
    kind: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    paymentMethod: { type: DataTypes.STRING(20), allowNull: false },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    userId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'SalePayment', tableName: 'sale_payments' }
);
