import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string; authVersion: number };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Authentication is not configured' });
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, secret);
    if (typeof verified === 'string' || typeof verified.sub !== 'string' && typeof verified.id !== 'string') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    decoded = verified;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const user = await User.findByPk(decoded.id ?? decoded.sub);
  if (!user || user.status !== 'active' || Number(decoded.tokenVersion ?? 0) !== user.authVersion) {
    return res.status(401).json({ error: 'Account is unavailable' });
  }

  req.user = { id: user.id, email: user.email, role: user.role, authVersion: user.authVersion };
  return next();
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};