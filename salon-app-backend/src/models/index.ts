import { User } from './User';
import { Client } from './Client';
import { Staff } from './Staff';
import { Attendance } from './Attendance';
import { Service } from './Service';
import { Product } from './Product';
import { Sale } from './Sales';
import { SaleItem } from './SaleItems';
import { Commission } from './Commissions';
import { Appointment } from './Appointment';
import { StockMovement } from './StockMovement';
import { Expense } from './Expense';
import { ReportArchive } from './ReportArchive';
import { CommissionPayment } from './CommissionPayment';

// Relations
// Financial and attendance history is protected: deleting a parent that still has history fails
// (ON DELETE RESTRICT, enforced on existing databases by migration 004-protect-financial-history).
const keepHistory = { onDelete: 'RESTRICT' } as const;

Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'items', ...keepHistory });
SaleItem.belongsTo(Sale, { foreignKey: 'saleId', ...keepHistory });
Commission.belongsTo(SaleItem, { foreignKey: 'saleItemId', ...keepHistory });

Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales', ...keepHistory });
Sale.belongsTo(Client, { foreignKey: 'clientId', ...keepHistory });

Staff.hasMany(Sale, { foreignKey: 'staffId', as: 'sales', ...keepHistory });
Sale.belongsTo(Staff, { foreignKey: 'staffId', ...keepHistory });
Staff.hasMany(Attendance, { foreignKey: 'staffId', ...keepHistory });
Attendance.belongsTo(Staff, { foreignKey: 'staffId', ...keepHistory });

Commission.belongsTo(Staff, { foreignKey: 'staffId', ...keepHistory });
Staff.hasMany(Commission, { foreignKey: 'staffId', as: 'commissions', ...keepHistory });

Appointment.belongsTo(Client, { foreignKey: 'clientId' });
Appointment.belongsTo(Staff, { foreignKey: 'staffId' });
Appointment.belongsTo(Service, { foreignKey: 'serviceId' });
Client.hasMany(Appointment, { foreignKey: 'clientId' });
Staff.hasMany(Appointment, { foreignKey: 'staffId' });
Service.hasMany(Appointment, { foreignKey: 'serviceId' });

Product.hasMany(StockMovement, { foreignKey: 'productId', as: 'movements' });
StockMovement.belongsTo(Product, { foreignKey: 'productId' });

export { User, Client, Staff, Attendance, Service, Product, Sale, SaleItem, Commission, CommissionPayment, Appointment, StockMovement, Expense, ReportArchive };