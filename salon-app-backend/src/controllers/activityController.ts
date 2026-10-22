import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware';
import { listActivity } from '../services/realtime';

const maxEvents = 200;

export const activityController = {
  // GET /activity?since=<ISO date>&limit=<1-200>: the changes made after `since` (all the recent ones
  // without it) that this account may read, newest first. Used by the activity feed and to catch up
  // after a disconnection.
  list: async (req: AuthRequest, res: Response) => {
    const { since, limit } = req.query;
    const sinceDate = typeof since === 'string' && since.length <= 40 ? new Date(since) : null;
    const count = limit === undefined ? maxEvents : Number(limit);
    if ((since !== undefined && (!sinceDate || !Number.isFinite(sinceDate.getTime()))) ||
        !Number.isInteger(count) || count < 1 || count > maxEvents) {
      return res.status(400).json({ error: 'Invalid activity filters' });
    }
    try {
      const events = await listActivity({ role: req.user!.role, staffId: req.user!.staffId }, sinceDate, count);
      return res.json({ events });
    } catch {
      return res.status(500).json({ error: 'Failed to load the activity' });
    }
  },
};
