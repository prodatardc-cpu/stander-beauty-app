import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '../config/database';
import { migrations } from './migrations';

// Distinct from the administrator bootstrap lock (71520411).
const migrationLockKey = 71520412;

const appliedMigrationNames = async (transaction?: Transaction) => {
  const [table] = await sequelize.query<{ name: string | null }>(
    `SELECT to_regclass('schema_migrations')::text AS "name"`,
    { type: QueryTypes.SELECT, transaction }
  );
  if (!table?.name) return new Set<string>();
  const rows = await sequelize.query<{ name: string }>('SELECT "name" FROM "schema_migrations"', { type: QueryTypes.SELECT, transaction });
  return new Set(rows.map((row) => row.name));
};

export const listPendingMigrations = async () => {
  const applied = await appliedMigrationNames();
  return migrations.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
};

export const runMigrations = async (log: (message: string) => void = console.log) => {
  const appliedNow: string[] = [];
  for (const migration of migrations) {
    await sequelize.transaction(async (transaction) => {
      // Serialises concurrent runners (e.g. two instances starting together); released at commit.
      await sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: migrationLockKey }, transaction });
      await sequelize.query(
        'CREATE TABLE IF NOT EXISTS "schema_migrations" ("name" VARCHAR(255) PRIMARY KEY, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now())',
        { transaction }
      );
      if ((await appliedMigrationNames(transaction)).has(migration.name)) return;
      await migration.up({ sequelize, transaction });
      await sequelize.query('INSERT INTO "schema_migrations" ("name") VALUES (:name)', { replacements: { name: migration.name }, transaction });
      appliedNow.push(migration.name);
      log(`Migration applied: ${migration.name}`);
    });
  }
  return appliedNow;
};

export const assertMigrationsApplied = async () => {
  const pending = await listPendingMigrations();
  if (pending.length) {
    throw new Error(`Pending database migrations: ${pending.join(', ')}. Run "npm run db:migrate" before starting the API.`);
  }
};
