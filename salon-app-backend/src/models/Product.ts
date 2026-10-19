import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Product extends Model {
  declare id: string;
  declare name: string;
  declare sku: string;
  declare priceBuy: number;
  declare priceSell: number;
  declare quantityStock: number;
  declare quantityReceived: number;
  declare lowStockThreshold: number;
  declare status: 'active' | 'inactive';
  declare category: string;
  declare imageUrl?: string;
  declare description: string | null;
}

Product.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    priceBuy: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    priceSell: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    quantityStock: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    quantityReceived: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lowStockThreshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // A web address or a compressed JPEG photo (data URL).
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Product',
    tableName: 'products',
  }
);