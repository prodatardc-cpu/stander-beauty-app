import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

const envPath =
  process.env.ENV_FILE ??
  [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'src/.env')].find(
    existsSync
  );

dotenv.config({ path: envPath, quiet: true });

const host = process.env.DB_HOST || 'localhost';
const port = Number.parseInt(process.env.DB_PORT || '5432', 10);
const databaseName = process.env.DB_NAME || 'salon_coiffure';

export const sequelize = new Sequelize(
  databaseName,
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD,
  {
    host,
    port,
    dialect: 'postgres',
    logging: false,
  }
);

// Startup errors from pg often carry an empty message (the details sit in an AggregateError):
// spell out what failed and where, so "connection refused" does not show up as a blank line.
export const describeDatabaseError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const parent = (error as { parent?: unknown }).parent ?? error.cause;
  const causes = parent instanceof AggregateError ? parent.errors : parent ? [parent] : [];
  const details = [error.message, ...causes.map((cause) => (cause instanceof Error ? cause.message : String(cause)))]
    .filter(Boolean);
  const message = [...new Set(details)].join(' — ') || error.name;
  if (!error.name.startsWith('SequelizeConnection') && !error.name.startsWith('SequelizeHost') && error.name !== 'SequelizeAccessDeniedError') {
    return message;
  }
  return `cannot reach PostgreSQL at ${host}:${port} (database "${databaseName}"): ${message}. ` +
    'Check that PostgreSQL is running and that DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD in .env are correct.';
};

// Only checks that the database answers: the schema is managed by versioned migrations (src/db).
export const connectDB = async () => {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD is missing from the backend environment (see .env.example).');
  try {
    await sequelize.authenticate();
  } catch (error) {
    throw new Error(describeDatabaseError(error), { cause: error });
  }
  console.log('Database connected');
};
