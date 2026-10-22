import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import type { AuthRequest } from '../middleware/authMiddleware';
import { Staff } from '../models/Staff';
import { User } from '../models/User';
import { createAuthToken } from '../services/authTokens';
import { disconnectUser } from '../services/realtime';
import { isUuid } from '../utils/validators';

// Roles the administrator can give; 'viewer' (Observateur) reads everything and writes nothing.
const teamRoles = ['staff', 'cashier', 'viewer'] as const;

// bcrypt ignores everything after 72 bytes: longer new passwords are refused rather than silently cut.
const isAcceptablePassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
const passwordRule = 'a password of 8 characters to 72 bytes';

// Compared against when the account does not exist (same bcrypt cost as real hashes), so that the
// response time does not tell existing accounts from unknown ones.
let dummyPasswordHash: Promise<string> | undefined;
const getDummyPasswordHash = () => (dummyPasswordHash ??= bcrypt.hash('placeholder-for-unknown-accounts', 10));

const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
  staffId: user.staffId ?? null,
  createdAt: user.createdAt,
});

// Checks a requested link between a team account and a staff record. `undefined` leaves the link
// unchanged and `null` removes it; returns an error response body, or null when the link is valid.
const staffLinkError = async (staffId: unknown, userId?: string) => {
  if (staffId === undefined || staffId === null) return null;
  if (!isUuid(staffId)) return { status: 400, error: 'Invalid staff ID' };
  const staff = await Staff.findByPk(staffId);
  if (!staff || staff.archivedAt) return { status: 404, error: 'Staff member not found' };
  const linked = await User.findOne({ where: { staffId, ...(userId && { id: { [Op.ne]: userId } }) } });
  if (linked) return { status: 409, error: 'This staff member is already linked to another account' };
  return null;
};

const isUniqueViolation = (error: unknown) => error instanceof Error && error.name === 'SequelizeUniqueConstraintError';

const uniqueViolationMessage = (error: unknown) =>
  'staffId' in ((error as { fields?: Record<string, unknown> }).fields ?? {})
    ? 'This staff member is already linked to another account'
    : 'Email already exists';

export const ensureAdminAccount = async () => {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(71520411)', { transaction });
    const adminCount = await User.count({ where: { role: 'admin' }, transaction });
    if (adminCount > 1) throw new Error('Multiple administrator accounts already exist; resolve them explicitly before startup.');
    if (adminCount === 1) return;

    const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) {
      throw new Error('Set INITIAL_ADMIN_EMAIL and an INITIAL_ADMIN_PASSWORD of at least 12 characters to initialize the administrator.');
    }

    const existing = await User.findOne({ where: { email }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing) throw new Error('The configured initial administrator email already belongs to a non-admin account. Promote it explicitly before startup.');

    await User.create({ email, passwordHash: password, role: 'admin' }, { transaction });
    console.log('Initial salon administrator created');
  });
};

export const authController = {
  currentUser: async (req: AuthRequest, res: Response) => {
    const user = req.user ? await User.findByPk(req.user.id) : null;
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is unavailable' });
    // The refreshed token keeps the original sign-in time (see SESSION_MAX_DAYS).
    return res.json({ user: publicUser(user), token: createAuthToken(user, req.user?.sessionStart) });
  },

  register: async (req: Request, res: Response) => {
    return res.status(403).json({ error: 'Public account creation is disabled. Ask an administrator to create an account.' });
  },

  // Brute-force limits are applied in front of this handler (middleware/loginRateLimit.ts).
  login: async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password ||
          email.length > 254 || password.length > 1024) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ where: { email: normalizedEmail } });
      // One bcrypt comparison in every case: unknown, disabled and existing accounts answer alike.
      const isValid = user ? await user.validatePassword(password) : await bcrypt.compare(password, await getDummyPasswordHash());
      if (!user || user.status !== 'active' || !isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = createAuthToken(user);

      res.json({ user: publicUser(user), token });
    } catch {
      res.status(500).json({ error: 'Login failed' });
    }
  },

  changePassword: async (req: AuthRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || currentPassword.length > 1024 || !isAcceptablePassword(newPassword)) {
      return res.status(400).json({ error: `Current password and ${passwordRule} are required.` });
    }
    const user = req.user ? await User.findByPk(req.user.id) : null;
    if (!user || !(await user.validatePassword(currentPassword))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await user.update({ passwordHash: newPassword, authVersion: user.authVersion + 1 });
    // Open real-time connections used the previous sessions: they reconnect with the new token.
    disconnectUser(user.id);
    return res.json({ success: true, token: createAuthToken(user) });
  },

  logoutAll: async (req: AuthRequest, res: Response) => {
    const user = req.user ? await User.findByPk(req.user.id) : null;
    if (!user) return res.status(401).json({ error: 'Account is unavailable' });
    await user.update({ authVersion: user.authVersion + 1 });
    disconnectUser(user.id);
    return res.json({ success: true });
  },

  resetUserPassword: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const { newPassword } = req.body ?? {};
    if (!isUuid(id) || !isAcceptablePassword(newPassword)) {
      return res.status(400).json({ error: `A user ID and ${passwordRule} are required.` });
    }
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.role === 'admin') return res.status(400).json({ error: 'Use the administrator account password settings.' });
      await user.update({ passwordHash: newPassword, authVersion: user.authVersion + 1 });
      disconnectUser(user.id);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Failed to reset user password' });
    }
  },

  listUsers: async (_req: Request, res: Response) => {
    try {
      const users = await User.findAll({ order: [['createdAt', 'ASC']] });
      return res.json(users.map(publicUser));
    } catch {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
  },

  createUser: async (req: Request, res: Response) => {
    const { email, password, role, staffId } = req.body ?? {};
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        !isAcceptablePassword(password) || !teamRoles.includes(role)) {
      return res.status(400).json({ error: `A valid email, ${passwordRule}, and a staff, cashier or viewer role are required.` });
    }
    try {
      const linkError = await staffLinkError(staffId);
      if (linkError) return res.status(linkError.status).json({ error: linkError.error });
      const user = await User.create({ email: email.trim().toLowerCase(), passwordHash: password, role, staffId: staffId ?? null });
      return res.status(201).json(publicUser(user));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: uniqueViolationMessage(error) });
      }
      return res.status(500).json({ error: 'Failed to create user' });
    }
  },

  updateUser: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const { role, status, staffId } = req.body ?? {};
    if (!isUuid(id) ||
        (role !== undefined && !teamRoles.includes(role)) ||
        (status !== undefined && !['active', 'inactive'].includes(status))) {
      return res.status(400).json({ error: 'Invalid role, status or user ID' });
    }
    if (id === req.user?.id) return res.status(400).json({ error: 'You cannot change your own role or status' });
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.role === 'admin') return res.status(400).json({ error: 'The administrator role cannot be changed here' });
      const linkError = await staffLinkError(staffId, id);
      if (linkError) return res.status(linkError.status).json({ error: linkError.error });
      await user.update({
        ...(role !== undefined && { role }),
        ...(status !== undefined && { status }),
        ...(staffId !== undefined && { staffId }),
      });
      // A blocked account loses its connections; a new role or staff record changes what it receives.
      disconnectUser(user.id);
      return res.json(publicUser(user));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: uniqueViolationMessage(error) });
      }
      return res.status(500).json({ error: 'Failed to update user' });
    }
  },
};
