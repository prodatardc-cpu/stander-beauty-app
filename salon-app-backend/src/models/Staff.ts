import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Staff extends Model {
  declare id: string;
  declare name: string;
  declare phone: string;
  declare position: string;
  declare photoUrl: string | null;
  declare status: 'active' | 'inactive';
  declare workingHours: unknown;
  declare commissionRate: number;
  declare archivedAt: Date | null;
}

Staff.init(
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
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    position: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    photoUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active',
    },
    workingHours: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    commissionRate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 40,
    },
    // Set when an administrator removes a member who has history (sales, commissions, attendance).
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Staff',
    tableName: 'staff',
  }
);