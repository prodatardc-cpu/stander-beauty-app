export interface User {
  id: string;
  email: string;
  role: "admin" | "staff" | "cashier";
  status: "active" | "inactive";
  // Staff record linked by the administrator: gives access to that member's own commissions.
  staffId?: string | null;
  createdAt?: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  photoUrl?: string;
  registrationDate: string;
  totalSpent: number | string;
  lastVisit?: string;
  notes?: string;
  loyaltyPoints: number;
  archivedAt?: string | null;
}

export interface Staff {
  id: string;
  name: string;
  phone: string;
  position: string;
  photoUrl?: string | null;
  status: "active" | "inactive";
  commissionRate: number | string;
  payType: 'fixed' | 'commission';
  monthlySalary: number | string;
  archivedAt?: string | null;
}

export interface StaffAttendance {
  staffId: string;
  attendanceDate: string;
  status: 'present' | 'absent';
}

export interface Service {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  duration: number;
  category: string;
  status: "active" | "inactive";
  audience: 'women' | 'men' | 'unisex';
  womenPrice?: number | string | null;
  menPrice?: number | string | null;
}

export interface Sale {
  id: string;
  clientId: string | null;
  clientName?: string | null;
  staffId: string | null;
  totalAmount: number;
  exchangeRateUsed?: number | string | null;
  status?: 'completed' | 'refunded';
  currency?: 'USD' | 'CDF' | null;
  paymentMethod: "cash" | "momo" | "card" | "transfer" | "other";
  saleDate: Date;
  amountPaid: number | string;
  remainingAmount: number | string;
  items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  type: "service" | "product";
  itemId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  audience?: 'women' | 'men' | null;
}

export interface Commission {
  id: string;
  staffId: string;
  saleItemId: string;
  servicePrice: number;
  commissionAmount: number;
  patronneAmount: number;
  date: Date;
  paid: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  priceBuy: number | string;
  priceSell: number | string;
  quantityStock: number;
  quantityReceived: number;
  lowStockThreshold: number;
  status: 'active' | 'inactive';
  category: string;
  imageUrl?: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number | string;
  paymentMethod: Sale['paymentMethod'];
  createdAt: string;
}

export interface ReportArchive {
  id: string;
  kind: 'daily' | 'annual';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  totalSales: number | string;
  amountReceived: number | string;
  outstandingAmount: number | string;
  serviceRevenue: number | string;
  productRevenue: number | string;
  totalExpenses: number | string;
  netBalance: number | string;
  totalCommissions: number | string;
  transactionCount: number;
  expenseCount: number;
  closedAt: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  staffId: string;
  serviceId: string;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  notes?: string;
  Client?: Pick<Client, 'id' | 'name' | 'phone'>;
  Staff?: Pick<Staff, 'id' | 'name'>;
  Service?: Pick<Service, 'id' | 'name' | 'duration' | 'price'>;
}

export interface DashboardOverview {
  clients: number;
  products: number;
  services: number;
  appointmentsToday: number;
  revenueToday: number;
  revenueTodayUSD: number;
  revenueTodayCDF: number;
  unclassifiedSalesToday: number;
  salesTodayUSDCount: number;
  salesTodayCDFCount: number;
  amountReceivedTodayUSD: number;
  amountReceivedTodayCDF: number;
  servicesToday: number;
  serviceRevenueToday: number;
  serviceRevenueTodayUSD: number;
  serviceRevenueTodayCDF: number;
  productsSoldToday: number;
  productRevenueToday: number;
  productRevenueTodayUSD: number;
  productRevenueTodayCDF: number;
  unpaidCommissions: number;
  unpaidCommissionsUSD: number;
  unpaidCommissionsCDF: number;
  unpaidCommissionCount: number;
}
export interface StockMovement {
  id: string;
  productId: string;
  type: 'in' | 'out';
  reason: 'initial' | 'reception' | 'sale' | 'sale_cancel' | 'adjustment';
  quantity: number;
  stockAfter: number;
  reference: string | null;
  note: string | null;
  userEmail: string | null;
  createdAt: string;
}

export interface StockAlert {
  productId: string;
  name: string;
  quantityStock: number;
  lowStockThreshold: number;
  level: 'low' | 'out';
}
