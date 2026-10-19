import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class ReportArchive extends Model {
  declare id: string;
  declare kind: 'daily' | 'annual';
  declare periodKey: string;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare totalSales: number;
  declare amountReceived: number;
  declare outstandingAmount: number;
  declare serviceRevenue: number;
  declare productRevenue: number;
  declare totalExpenses: number;
  declare netBalance: number;
  declare totalCommissions: number;
  declare transactionCount: number;
  declare expenseCount: number;
  declare closedAt: Date;
  declare breakdown: Record<string, unknown> | null;
}

ReportArchive.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    kind: { type: DataTypes.STRING, allowNull: false },
    periodKey: { type: DataTypes.STRING, allowNull: false },
    periodStart: { type: DataTypes.DATE, allowNull: false },
    periodEnd: { type: DataTypes.DATE, allowNull: false },
    totalSales: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    amountReceived: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    outstandingAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    serviceRevenue: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    productRevenue: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    totalExpenses: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    netBalance: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    totalCommissions: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    transactionCount: { type: DataTypes.INTEGER, allowNull: false },
    expenseCount: { type: DataTypes.INTEGER, allowNull: false },
    closedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    // Figures per currency (USD, CDF). Archives made before it existed only have the mixed totals above.
    breakdown: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    modelName: 'ReportArchive',
    tableName: 'report_archives',
    indexes: [{ unique: true, fields: ['kind', 'periodKey'] }],
  }
);