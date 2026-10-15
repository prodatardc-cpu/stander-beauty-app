import type { NextFunction, Request, Response } from 'express';
import { isUuid } from '../utils/validators';

// router.param() handler: route identifiers are UUIDs, anything else is answered 400 before it
// reaches the database.
export const uuidParam = (_req: Request, res: Response, next: NextFunction, value: unknown) => {
  if (isUuid(value)) return next();
  return res.status(400).json({ error: 'Invalid ID' });
};
