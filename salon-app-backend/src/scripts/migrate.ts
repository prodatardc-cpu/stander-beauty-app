import { sequelize } from '../config/database';
import { listPendingMigrations, runMigrations } from '../db/migrator';

// Usage: npm run db:migrate            -> applies pending migrations
//        npm run db:migrate -- --status -> lists pending migrations without applying them
const main = async () => {
  await sequelize.authenticate();
  if (process.argv.includes('--status')) {
    const pending = await listPendingMigrations();
    console.log(pending.length ? `Pending migrations: ${pending.join(', ')}` : 'Database schema is up to date.');
    return;
  }
  const applied = await runMigrations();
  console.log(applied.length ? `${applied.length} migration(s) applied.` : 'Database schema is already up to date.');
};

main()
  .catch((error: unknown) => {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
