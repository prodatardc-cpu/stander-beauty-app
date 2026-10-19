import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import type { Currency } from '../utils/money';

// The salon's single settings row (id = 1), shared by every device: catalogue prices, salaries
// and client totals are expressed in baseCurrency; usdToCdfRate prices sales in the other currency.
export class SalonSettings extends Model {
  declare id: number;
  declare baseCurrency: Currency;
  declare usdToCdfRate: number | string | null;
  declare businessName: string;
  declare businessEmail: string | null;
  declare businessPhone: string | null;
  declare taxId: string | null;
  declare businessAddress: string | null;
  declare payPeriod: 'weekly' | 'monthly';
  declare updatedByUserId: string | null;
  declare updatedAt: Date;
}

SalonSettings.init(
  {
    id: { type: DataTypes.SMALLINT, primaryKey: true, defaultValue: 1 },
    baseCurrency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    usdToCdfRate: { type: DataTypes.DECIMAL(12, 4), allowNull: true },
    // Shown at the top of receipts.
    businessName: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Stander Beauty' },
    businessEmail: { type: DataTypes.STRING(254), allowNull: true },
    businessPhone: { type: DataTypes.STRING(40), allowNull: true },
    taxId: { type: DataTypes.STRING(60), allowNull: true },
    businessAddress: { type: DataTypes.STRING(255), allowNull: true },
    // Length of a remuneration period (team pay summaries).
    payPeriod: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'monthly' },
    updatedByUserId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, modelName: 'SalonSettings', tableName: 'salon_settings' }
);
