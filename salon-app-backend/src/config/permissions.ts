export type Role = 'admin' | 'cashier' | 'staff';

/**
 * Role matrix enforced by the API. The web app mirrors it (salon-app-web/src/utils/permissions.ts)
 * only to hide the controls a role cannot use: the server remains the authority.
 *
 * - admin   (Administrateur): the salon manager, full access.
 * - cashier (Caisse): front desk; till, clients, appointments, attendance and closing the day.
 * - staff   (Équipe): team member; till, clients and appointments, and only their own commissions
 *   (through the staff record linked to their account by the administrator).
 *
 * Every signed-in role can read the catalogue, the team list, sales, expenses and period reports,
 * record sales and expenses, and manage clients and appointments.
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
  readAnyStaffFinancials: ['admin'],
  payCommissions: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export const hasRole = (roles: readonly Role[], role: Role | undefined) => role !== undefined && roles.includes(role);
