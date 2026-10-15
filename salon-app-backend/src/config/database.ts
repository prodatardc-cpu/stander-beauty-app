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

const databasePassword = process.env.DB_PASSWORD;

if (!databasePassword) {
  throw new Error('DB_PASSWORD is missing from the backend environment.');
}

export const sequelize = new Sequelize(
  process.env.DB_NAME || 'salon_coiffure',
  process.env.DB_USER || 'postgres',
  databasePassword,
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    dialect: 'postgres',
    logging: false,
  }
);

// Only checks that the database answers: the schema is managed by versioned migrations (src/db).
export const connectDB = async () => {
  await sequelize.authenticate();
  console.log('Database connected');
};
