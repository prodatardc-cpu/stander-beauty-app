import { randomUUID } from 'node:crypto';
import type { Role } from '../../src/config/permissions';
import { Client, Product, Service, Staff, User } from '../../src/models';
import { createAuthToken } from '../../src/services/authTokens';

const unique = () => randomUUID().slice(0, 8);

export const defaultPassword = 'correct horse battery staple';

export const createAccount = async (
  role: Role,
  { staffId = null, email, status = 'active' }: { staffId?: string | null; email?: string; status?: 'active' | 'inactive' } = {}
) => {
  const user = await User.create({ email: email ?? `${role}-${unique()}@example.com`, passwordHash: defaultPassword, role, staffId, status });
  return { user, token: createAuthToken(user) };
};

export const createStaffMember = (overrides: Record<string, unknown> = {}) =>
  Staff.create({ name: `Membre ${unique()}`, phone: '+243990000000', position: 'Coiffeuse', commissionRate: 40, ...overrides });

export const createClient = (overrides: Record<string, unknown> = {}) =>
  Client.create({ name: `Client ${unique()}`, phone: `+243${Math.floor(100_000_000 + Math.random() * 899_999_999)}`, ...overrides });

export const createService = (overrides: Record<string, unknown> = {}) =>
  Service.create({ name: `Coupe ${unique()}`, price: 20, duration: 30, category: 'Coiffure', ...overrides });

export const createProduct = (overrides: Record<string, unknown> = {}) =>
  Product.create({
    name: `Shampooing ${unique()}`, sku: `SKU-${unique()}`.toUpperCase(), priceBuy: 4, priceSell: 10,
    quantityStock: 10, quantityReceived: 10, category: 'Soins', ...overrides,
  });

// Local date (YYYY-MM-DD), as the reports and attendance endpoints expect it.
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A Monday (attendance is recorded from Monday to Saturday).
export const workDay = '2026-10-12';
