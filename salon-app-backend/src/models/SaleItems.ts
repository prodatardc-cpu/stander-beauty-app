import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class SaleItem extends Model {
  declare id: string;
  declare saleId: string;
  declare type: 'service' | 'product';
  declare itemId: string;
  declare quantity: number;
  declare unitPrice: number;
  declare subtotal: number;
}

SaleItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    saleId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('service', 'product'),
      allowNull: false,
    },
    itemId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'SaleItem',
    tableName: 'sale_items',
  }
);