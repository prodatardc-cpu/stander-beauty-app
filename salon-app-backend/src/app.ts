import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { sequelize } from './config/database';
import { isProduction, parseCorsOrigins, parseTrustProxy } from './config/env';
import { errorHandler, notFoundHandler, securityHeaders } from './middleware/httpSecurity';
import { createLoginRateLimiter } from './middleware/loginRateLimit';
import authRoutes from './routes/authRoutes';
import clientRoutes from './routes/clientRoutes';
import commissionRoutes from './routes/commissionRoutes';
import saleRoutes from './routes/saleRoutes';
import managementRoutes from './routes/managementRoutes';

type AppOptions = {
  // Readiness probe; replaceable in tests to simulate an unreachable database.
  checkDatabase?: () => Promise<unknown>;
};

const readinessTimeoutMs = 3000;
// Largest legitimate body: a staff member with a compressed photo (≤ 90 000 characters).
const maxBodySize = '100kb';

const pingDatabase = () => sequelize.query('SELECT 1');

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });

export const createApp = ({ checkDatabase = pingDatabase }: AppOptions = {}): Express => {
  const app = express();
  const production = isProduction();

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  // Middleware
  app.use(securityHeaders(production));
  app.use(cors({
    origin: parseCorsOrigins(process.env.CORS_ORIGIN, production),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: maxBodySize }));

  // Liveness: the API process answers, whatever the state of the database.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
  });

  // Readiness: the database really answers a query.
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await withTimeout(Promise.resolve().then(checkDatabase), readinessTimeoutMs);
      res.json({ status: 'ready', database: 'up' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  // Routes
  app.post('/api/auth/login', createLoginRateLimiter());
  app.use('/api/auth', authRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/commissions', commissionRoutes);
  app.use('/api/sales', saleRoutes);
  app.use('/api', managementRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
