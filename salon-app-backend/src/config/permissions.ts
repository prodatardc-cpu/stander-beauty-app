export type Role = 'admin' | 'cashier' | 'staff' | 'viewer';

/**
 * Role matrix enforced by the API. The web app mirrors it (salon-app-web/src/utils/permissions.ts)
 * only to hide the controls a role cannot use: the server remains the authority.
 *
 * - admin   (Administrateur): the salon manager, full access.
 * - cashier (Caisse): front desk; till, clients, appointments, attendance and closing the day.
 * - staff   (Équipe): team member; till, clients and appointments, and only their own commissions
 *   (through the staff record linked to their account by the administrator).
 * - viewer  (Observateur): reads everything the administrator reads and writes nothing; every
 *   request other than GET/HEAD is refused (authMiddleware), except changing its own password and
 *   closing its sessions. Used by the read-only mobile app.
 *
 * Every signed-in role can read the catalogue, the team list, sales, expenses and period reports;
 * every role but viewer can record sales and expenses, and manage clients and appointments.
 * Only read policies (used by GET routes) may list viewer.
 */
export const policy = {
  manageUsers: ['admin'],
  manageCatalog: ['admin'],
  manageStaff: ['admin'],
  archiveClients: ['admin'],
  adjustLoyaltyPoints: ['admin'],
  cancelSales: ['admin'],
  deleteExpenses: ['admin'],
  recordAttendance: ['admin', 'cashier'],
  closeDay: ['admin', 'cashier'],
  closeYear: ['admin'],
  // Commissions and per-member reports of any team member (others only see their own).
  readAnyStaffFinancials: ['admin', 'viewer'],
  payCommissions: ['admin'],
  // Base currency and USD/CDF rate, shared by every device.
  manageSettings: ['admin'],
  // Daily history and cash journal (they show team payouts), cash entries, withdrawals and counts.
  readHistory: ['admin', 'cashier', 'viewer'],
  recordCash: ['admin', 'cashier'],
  // Stock movements of a product (who received, sold or adjusted what).
  readStockMovements: ['admin', 'viewer'],
} as const satisfies Record<string, readonly Role[]>;

// Requests a viewer account may send besides GET/HEAD: its own password and sessions only
// (signing in goes through POST /api/auth/login, which is not authenticated).
export const viewerWriteExceptions: readonly { method: string; path: string }[] = [
  { method: 'PUT', path: '/api/auth/password' },
  { method: 'POST', path: '/api/auth/logout-all' },
];

export const hasRole = (roles: readonly Role[], role: Role | undefined) => role !== undefined && roles.includes(role);
