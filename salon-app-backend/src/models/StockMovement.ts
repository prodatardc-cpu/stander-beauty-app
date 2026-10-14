import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type StockMovementReason = 'initial' | 'reception' | 'sale' | 'sale_cancel' | 'adjustment';

export class StockMovement extends Model {
  declare id: string;
  declare productId: string;
  declare type: 'in' | 'out';
  declare reason: StockMovementReason;
  declare quantity: number;
  declare stockAfter: number;
  declare reference: string | null;
  declare note: string | null;
  declare userId: string | null;
  declare createdAt: Date;
}

StockMovement.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    productId: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    stockAfter: { type: DataTypes.INTEGER, allowNull: false },
    reference: { type: DataTypes.STRING, allowNull: true },
    note: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: true },
  },
  {
    sequelize,
    modelName: 'StockMovement',
    tableName: 'stock_movements',
    indexes: [{ fields: ['productId', 'createdAt'] }],
  }
);