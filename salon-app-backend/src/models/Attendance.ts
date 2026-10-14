import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export type AttendanceStatus = 'present' | 'absent';

export class Attendance extends Model {
  declare id: string;
  declare staffId: string;
  declare attendanceDate: string;
  declare status: AttendanceStatus;
}

Attendance.init(
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
    attendanceDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('present', 'absent'),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Attendance',
    tableName: 'attendances',
    indexes: [{ unique: true, fields: ['staffId', 'attendanceDate'] }],
  }
);