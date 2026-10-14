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

// Relations
Sale.hasMany(SaleItem, { foreignKey: 'saleId', as: 'items' });
SaleItem.belongsTo(Sale, { foreignKey: 'saleId' });
Commission.belongsTo(SaleItem, { foreignKey: 'saleItemId' });

Client.hasMany(Sale, { foreignKey: 'clientId', as: 'sales' });
Sale.belongsTo(Client, { foreignKey: 'clientId' });

Staff.hasMany(Sale, { foreignKey: 'staffId', as: 'sales' });
Sale.belongsTo(Staff, { foreignKey: 'staffId' });
Staff.hasMany(Attendance, { foreignKey: 'staffId', onDelete: 'CASCADE' });
Attendance.belongsTo(Staff, { foreignKey: 'staffId' });

Commission.belongsTo(Staff, { foreignKey: 'staffId' });
Staff.hasMany(Commission, { foreignKey: 'staffId', as: 'commissions' });

Appointment.belongsTo(Client, { foreignKey: 'clientId' });
Appointment.belongsTo(Staff, { foreignKey: 'staffId' });
Appointment.belongsTo(Service, { foreignKey: 'serviceId' });
Client.hasMany(Appointment, { foreignKey: 'clientId' });
Staff.hasMany(Appointment, { foreignKey: 'staffId' });
Service.hasMany(Appointment, { foreignKey: 'serviceId' });

Product.hasMany(StockMovement, { foreignKey: 'productId', as: 'movements' });
StockMovement.belongsTo(Product, { foreignKey: 'productId' });

export { User, Client, Staff, Attendance, Service, Product, Sale, SaleItem, Commission, Appointment, StockMovement, Expense, ReportArchive };