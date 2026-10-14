export interface IUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'staff' | 'cashier';
  status: 'active' | 'inactive';
  staffId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClient {
  id: string;
  name: string;
  phone: string;
  photoUrl?: string;
  registrationDate: Date;
  totalSpent: number;
  lastVisit?: Date;
  notes?: string;
  loyaltyPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStaff {
  id: string;
  name: string;
  phone: string;
  position: string;
  status: 'active' | 'inactive';
  workingHours: Record<string, unknown>;
  commissionRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IService {
  id: string;
  name: string;
  description?: string;
  price: number;
  duration: number;
  category: string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

export interface IProduct {
  id: string;
  name: string;
  sku: string;
  priceBuy: number;
  priceSell: number;
  quantityStock: number;
  category: string;
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISale {
  id: string;
  clientId: string | null;
  clientName?: string | null;
  staffId: string | null;
  saleDate: Date;
  totalAmount: number;
  paymentMethod: 'cash' | 'momo' | 'card' | 'transfer' | 'other';
  status: 'completed' | 'refunded';
  discountAmount?: number;
  amountPaid: number;
  remainingAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISaleItem {
  id: string;
  saleId: string;
  type: 'service' | 'product';
  itemId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICommission {
  id: string;
  staffId: string;
  saleItemId: string;
  servicePrice: number;
  commissionAmount: number;
  patronneAmount: number;
  date: Date;
  paid: boolean;
  paymentDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppointment {
  id: string;
  clientId: string;
  staffId: string;
  serviceId: string;
  scheduledAt: Date;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExpense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: Date;
  receipt?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInventoryMovement {
  id: string;
  productId: string;
  type: 'in' | 'out';
  quantity: number;
  date: Date;
  reason: string;
  reference?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuditLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}