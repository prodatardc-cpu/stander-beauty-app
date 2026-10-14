import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { connectDB } from './config/database';
import { ensureAdminAccount } from './controllers/authController';
import authRoutes from './routes/authRoutes';
import clientRoutes from './routes/clientRoutes';
import commissionRoutes from './routes/commissionRoutes';
import saleRoutes from './routes/saleRoutes';
import managementRoutes from './routes/managementRoutes';

const app: Express = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:5173,http://127.0.0.1:5173'
).split(',');

// Middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/sales', saleRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ message: 'Server is running' });
});

app.use('/api', managementRoutes);

// Santé check
// Démarrage
const startServer = async () => {
  try {
    await connectDB();
    await ensureAdminAccount();
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

startServer();
