import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Commission extends Model {
  declare id: string;
  declare staffId: string;
  declare saleItemId: string;
  declare servicePrice: number;
  declare commissionAmount: number;
  declare patronneAmount: number;
  declare date: Date;
  declare paid: boolean;
  declare paymentDate?: Date;
  declare paymentId: string | null;
}

Commission.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    staffId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    saleItemId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    servicePrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    commissionAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    patronneAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    date: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    paid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Settlement that paid this commission (commission_payments); its foreign key is added by migration 005.
    paymentId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Commission',
    tableName: 'commissions',
  }
);