import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Service extends Model {
  declare id: string;
  declare name: string;
  declare description?: string;
  declare price: number;
  declare duration: number;
  declare category: string;
  declare status: 'active' | 'inactive';
}

Service.init(
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active',
    },
  },
  {
    sequelize,
    modelName: 'Service',
    tableName: 'services',
  }
);