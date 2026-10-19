import type { Currency } from '../services/currency';

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
  receiptNumber?: number | string;
  createdByUserId?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
}

export interface SalePayment {
  id: string;
  saleId: string;
  kind: 'sale' | 'debt';
  amount: number | string;
  currency: Currency;
  paymentMethod: Sale['paymentMethod'];
  createdAt: string;
}

export interface BusinessDetails {
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  taxId: string | null;
  businessAddress: string | null;
}

// GET /sales/:id: everything a receipt needs.
export interface SaleReceipt extends Sale {
  clientLabel: string | null;
  staffName: string | null;
  createdByEmail: string | null;
  cancelledByEmail: string | null;
  discountAmount?: number | string;
  business: BusinessDetails;
}

export interface SaleItem {
  id: string;
  type: "service" | "product";
  itemId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  audience?: 'women' | 'men' | null;
  itemName?: string | null;
}

export interface Commission {
  id: string;
  staffId: string;
  saleItemId: string;
  servicePrice: number;
  commissionAmount: number;
  patronneAmount: number;
  currency: Currency;
  date: Date;
  paid: boolean;
}

// Commission totals of a staff member, per currency (GET /commissions/staff/:id/total).
export type CommissionTotals = Record<Currency, { total: number; paid: number; remaining: number }>;

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
  description?: string | null;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number | string;
  currency: Currency;
  paymentMethod: Sale['paymentMethod'];
  createdAt: string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

// Figures of a period in one currency (GET /reports/period, archive breakdowns).
export interface PeriodFigures {
  // Turnover (cancelled sales excluded), split between services and products.
  totalSales: number;
  serviceRevenue: number;
  productRevenue: number;
  transactionCount: number;
  // Money received (sales and debt payments) and given back on cancellations.
  amountReceived: number;
  refunds?: number;
  outstandingAmount: number;
  totalExpenses: number;
  expenseCount: number;
  totalCommissions: number;
  payroll?: number;
  fixedSalaryPayroll?: number;
  adjustmentsIn?: number;
  adjustmentsOut?: number;
  // null when an older product sale has no recorded purchase cost.
  costOfGoods?: number | null;
  estimatedProfit?: number | null;
  // Cash result: received − refunds − expenses − payroll ± adjustments.
  netBalance: number;
}

export interface PeriodReport {
  period: { start: string; end: string };
  byCurrency: Record<Currency, PeriodFigures>;
  // Old sales recorded without a currency: counted in neither total.
  unclassifiedSales: number;
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
  // Per-currency figures; null for archives closed before currencies were tracked (mixed totals above).
  breakdown: { baseCurrency: Currency; byCurrency: Record<Currency, PeriodFigures>; unclassifiedSales: number } | null;
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
  price?: number | string | null;
  currency?: Currency | null;
}

export interface DashboardOverview {
  clients: number;
  products: number;
  services: number;
  appointmentsToday: number;
  servicesToday: number;
  productsSoldToday: number;
  unclassifiedSalesToday: number;
  today: Record<Currency, PeriodFigures>;
  // Still owed by clients, all dates.
  debts: Record<Currency, { amount: number; count: number }>;
  // Still due to the team, all dates.
  payrollDue: Record<Currency, number>;
}

export type JournalEntry = {
  id: string;
  at: string;
  type: 'sale_payment' | 'debt_payment' | 'refund' | 'expense' | 'expense_cancel' | 'payout' | 'adjustment';
  direction: 'in' | 'out';
  amount: number;
  currency: Currency;
  paymentMethod: Sale['paymentMethod'];
  label: string;
  saleId?: string;
  receiptNumber?: number;
  userEmail?: string | null;
};

export interface CashCount {
  id: string;
  day: string;
  currency: Currency;
  expectedAmount: number | string;
  countedAmount: number | string;
  difference?: number;
  note: string | null;
  createdAt: string;
}

type PayAmounts = { eligibleRevenue: number; servicesCount: number; earned: number; advances: number; payments: number };
export interface CurrencyPay {
  period: PayAmounts;
  total: PayAmounts;
  carriedOver: number;
  remaining: number;
}

export interface StaffPay {
  staffId: string;
  name: string;
  position: string;
  photoUrl: string | null;
  status: string;
  archivedAt: string | null;
  payType: 'commission' | 'fixed';
  commissionRate: number;
  monthlySalary: number;
  period: { kind: 'weekly' | 'monthly'; start: string; end: string };
  byCurrency: Record<Currency, CurrencyPay>;
}

export interface StaffPayout {
  id: string;
  staffId: string;
  kind: 'advance' | 'payment';
  amount: number | string;
  currency: Currency;
  paymentMethod: Sale['paymentMethod'];
  note: string | null;
  createdAt: string;
}

export interface PerformedService {
  saleId: string;
  receiptNumber: number;
  date: string;
  name: string;
  audience: 'women' | 'men' | null;
  quantity: number;
  amount: number;
  currency: Currency | null;
  status: 'completed' | 'refunded';
  commission: number | null;
}

// GET /payroll/:staffId
export interface StaffPayDetail extends StaffPay {
  services: PerformedService[];
  payouts: StaffPayout[];
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
