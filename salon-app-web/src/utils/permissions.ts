import type { User } from '../types';

type Role = User['role'];

// Mirror of the API role matrix (salon-app-backend/src/config/permissions.ts), used only to hide the
// controls a role cannot use: the API enforces the rules whatever the interface shows.
const policy = {
  recordAttendance: ['admin', 'cashier'],
  closeDay: ['admin', 'cashier'],
  readAnyStaffFinancials: ['admin'],
  manageSettings: ['admin'],
  cancelSales: ['admin'],
  readHistory: ['admin', 'cashier'],
  recordCash: ['admin', 'cashier'],
  payCommissions: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof policy;

export const can = (user: Pick<User, 'role'> | null | undefined, permission: Permission) =>
  Boolean(user && (policy[permission] as readonly Role[]).includes(user.role));
