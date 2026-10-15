import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

// One settlement of a staff member's commissions; the commissions it covers point to it (paymentId).
export class CommissionPayment extends Model {
  declare id: string;
  declare staffId: string;
  declare amount: number;
  declare requestedAmount: number;
  declare commissionCount: number;
  declare idempotencyKey: string;
  declare paidByUserId: string | null;
  declare createdAt: Date;
}

CommissionPayment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    staffId: { type: DataTypes.UUID, allowNull: false },
    // What was actually settled, and what the administrator asked to settle.
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    requestedAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    commissionCount: { type: DataTypes.INTEGER, allowNull: false },
    // Sent by the client for each payment intent: replaying it returns this payment instead of paying twice.
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    paidByUserId: { type: DataTypes.UUID, allowNull: true },
  },
  {
    sequelize,
    modelName: 'CommissionPayment',
    tableName: 'commission_payments',
  }
);
