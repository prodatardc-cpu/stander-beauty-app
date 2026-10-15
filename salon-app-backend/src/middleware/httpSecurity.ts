import type { NextFunction, Request, Response } from 'express';

// The API only serves JSON: forbid sniffing, framing, referrers and caching of its responses
// (they carry tokens and financial data).
export const securityHeaders = (production: boolean) => (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
};

// Every error answers in JSON, without stack trace or internal detail; only 5xx are logged, with
// their name and message (never request bodies or SQL parameters).
export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  if (type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (typeof status === 'number' && status >= 400 && status < 500) return res.status(status).json({ error: 'Invalid request' });
  console.error('Unhandled request error:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
  return res.status(500).json({ error: 'Internal server error' });
};
