import type { Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { sequelize } from '../config/database';
import type { AuthRequest } from '../middleware/authMiddleware';
import { User } from '../models/User';

const teamRoles = ['staff', 'cashier'] as const;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is missing from the backend environment.');
  }
  return secret;
};

const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
});

const createToken = (user: User) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, tokenVersion: user.authVersion },
    getJwtSecret(),
    { expiresIn: (process.env.JWT_EXPIRE || '7d') as SignOptions['expiresIn'] }
  );

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
    return res.json({ user: publicUser(user), token: createToken(user) });
  },

  register: async (req: Request, res: Response) => {
    return res.status(403).json({ error: 'Public account creation is disabled. Ask an administrator to create an account.' });
  },

  login: async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ where: { email: normalizedEmail } });
      if (!user || user.status !== 'active') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await user.validatePassword(password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = createToken(user);

      res.json({ user: publicUser(user), token });
    } catch {
      res.status(500).json({ error: 'Login failed' });
    }
  },

  changePassword: async (req: AuthRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required.' });
    }
    const user = req.user ? await User.findByPk(req.user.id) : null;
    if (!user || !(await user.validatePassword(currentPassword))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    await user.update({ passwordHash: newPassword, authVersion: user.authVersion + 1 });
    return res.json({ success: true, token: createToken(user) });
  },

  logoutAll: async (req: AuthRequest, res: Response) => {
    const user = req.user ? await User.findByPk(req.user.id) : null;
    if (!user) return res.status(401).json({ error: 'Account is unavailable' });
    await user.update({ authVersion: user.authVersion + 1 });
    return res.json({ success: true });
  },

  resetUserPassword: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const { newPassword } = req.body ?? {};
    if (typeof id !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'A user ID and a new password of at least 8 characters are required.' });
    }
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.role === 'admin') return res.status(400).json({ error: 'Use the administrator account password settings.' });
      await user.update({ passwordHash: newPassword, authVersion: user.authVersion + 1 });
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
    const { email, password, role } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || password.length < 8 || !teamRoles.includes(role)) {
      return res.status(400).json({ error: 'A valid email, a password of at least 8 characters, and a staff or cashier role are required.' });
    }
    try {
      const user = await User.create({ email: email.trim().toLowerCase(), passwordHash: password, role });
      return res.status(201).json(publicUser(user));
    } catch (error) {
      if (error instanceof Error && error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      return res.status(500).json({ error: 'Failed to create user' });
    }
  },

  updateUser: async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const { role, status } = req.body ?? {};
    if (typeof id !== 'string' ||
        (role !== undefined && !teamRoles.includes(role)) ||
        (status !== undefined && !['active', 'inactive'].includes(status))) {
      return res.status(400).json({ error: 'Invalid role, status or user ID' });
    }
    if (id === req.user?.id) return res.status(400).json({ error: 'You cannot change your own role or status' });
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.role === 'admin') return res.status(400).json({ error: 'The administrator role cannot be changed here' });
      await user.update({ ...(role !== undefined && { role }), ...(status !== undefined && { status }) });
      return res.json(publicUser(user));
    } catch {
      return res.status(500).json({ error: 'Failed to update user' });
    }
  },
};