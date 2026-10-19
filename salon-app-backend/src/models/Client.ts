import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Client extends Model {
  declare id: string;
  declare name: string;
  declare phone: string;
  declare photoUrl?: string;
  declare registrationDate: Date;
  declare totalSpent: number;
  declare lastVisit?: Date;
  declare notes?: string;
  declare loyaltyPoints: number;
  declare archivedAt: Date | null;
}

Client.init(
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
      unique: true,
    },
    photoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    registrationDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    totalSpent: {
      type: DataTypes.DECIMAL(14, 2),
      defaultValue: 0,
    },
    lastVisit: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    loyaltyPoints: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // Set when an administrator removes a client who has history (sales, appointments).
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Client',
    tableName: 'clients',
  }
);