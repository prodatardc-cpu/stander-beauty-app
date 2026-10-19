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
  declare audience: 'women' | 'men' | null;
  declare itemName: string | null;
  declare unitCost: number | string | null;
  declare catalogUnitPrice: number | string | null;
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
    // Name at the time of the sale, so that receipts do not change when the catalogue does.
    itemName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Product lines: purchase price in the sale's currency at the time of the sale (for margins).
    unitCost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    // Service lines priced by hand at the till: the catalogue price they replaced.
    catalogUnitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    // Service lines: the audience whose price was charged.
    audience: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'SaleItem',
    tableName: 'sale_items',
  }
);