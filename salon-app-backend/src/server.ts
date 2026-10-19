import { createApp } from './app';
import { connectDB, describeDatabaseError } from './config/database';
import { checkConfiguration, isProduction } from './config/env';
import { ensureAdminAccount } from './controllers/authController';
import { assertMigrationsApplied, runMigrations } from './db/migrator';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
// Development applies pending migrations at startup; production only checks them unless
// DB_AUTO_MIGRATE=true is set explicitly (otherwise run "npm run db:migrate" during the deployment).
const autoMigrate = (process.env.DB_AUTO_MIGRATE ?? (isProduction() ? 'false' : 'true')) === 'true';

// Démarrage
const startServer = async () => {
  try {
    for (const warning of checkConfiguration()) console.warn(`⚠️  ${warning}`);
    await connectDB();
    if (autoMigrate) await runMigrations();
    else await assertMigrationsApplied();
    await ensureAdminAccount();
    createApp().listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Server startup failed:', describeDatabaseError(error));
    process.exit(1);
  }
};

startServer();
