import { QueryTypes, Sequelize } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { runMigrations } from '../../src/db/migrator';
import { clearActivityBuffer, flushActivity } from '../../src/services/realtime';

const databaseName = () => {
  const name = process.env.DB_NAME ?? '';
  // test/register.js already enforces this; checked again because the next steps wipe the database.
  if (!/^\w+_test$/.test(name)) throw new Error(`Refusing to reset "${name}": not a test database.`);
  return name;
};

const createDatabaseIfMissing = async () => {
  const name = databaseName();
  const admin = new Sequelize('postgres', process.env.DB_USER || 'postgres', process.env.DB_PASSWORD, {
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    dialect: 'postgres',
    logging: false,
  });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = :name', { replacements: { name }, type: QueryTypes.SELECT });
    if (!existing.length) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.close();
  }
};

export const prepareDatabase = async () => {
  await createDatabaseIfMissing();
  await runMigrations(() => undefined);
};

export const resetDatabase = async () => {
  databaseName();
  // Activity events of the previous test are written after its responses: let them land first.
  await flushActivity();
  clearActivityBuffer();
  const tables = await sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'`,
    { type: QueryTypes.SELECT }
  );
  if (tables.length) {
    await sequelize.query(`TRUNCATE ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
};

export const closeDatabase = async () => {
  await flushActivity();
  await sequelize.close();
};
