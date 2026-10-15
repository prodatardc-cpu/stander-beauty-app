import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../config/permissions';
import { User } from '../models/User';
import { verifyAuthToken } from '../services/authTokens';

export interface AuthRequest extends Request {
  user?: { id: string; role: Role; email: string; authVersion: number; staffId: string | null; sessionStart: number };
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

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: 'Authentication is not configured' });
  }

  const claims = verifyAuthToken(token);
  if (!claims) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const user = await User.findByPk(claims.userId);
  if (!user || user.status !== 'active' || claims.tokenVersion !== user.authVersion) {
    return res.status(401).json({ error: 'Account is unavailable' });
  }

  req.user = {
    id: user.id, email: user.email, role: user.role, authVersion: user.authVersion,
    staffId: user.staffId ?? null, sessionStart: claims.sessionStart,
  };
  return next();
};

export const requireRole = (roles: readonly Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};

// Data about one team member (commissions, per-member report): reachable by `roles`, or by the
// account the administrator linked to that staff record.
export const requireOwnStaffDataOr = (roles: readonly Role[], param = 'staffId') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const staffId = req.params[param];
    const isOwnRecord = Boolean(req.user?.staffId) && req.user?.staffId === staffId;
    if (!req.user || (!roles.includes(req.user.role) && !isOwnRecord)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};
