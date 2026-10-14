import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { DataTypes, Sequelize } from 'sequelize';

const envPath =
  process.env.ENV_FILE ??
  [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'src/.env')].find(
    existsSync
  );

dotenv.config({ path: envPath });

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

export const connectDB = async () => {
  await sequelize.authenticate();
  console.log('Database connected');
  await sequelize.sync();
  await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0');
  const queryInterface = sequelize.getQueryInterface();
  const saleColumns = await queryInterface.describeTable('sales');
  if (!saleColumns.currency) {
    await queryInterface.addColumn('sales', 'currency', { type: DataTypes.STRING(3), allowNull: true });
  }
  if (!saleColumns.exchangeRateUsed) {
    await queryInterface.addColumn('sales', 'exchangeRateUsed', { type: DataTypes.DECIMAL(12, 4), allowNull: true });
  }
  const productColumns = await queryInterface.describeTable('products');
  if (!productColumns.lowStockThreshold) {
    await queryInterface.addColumn('products', 'lowStockThreshold', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 });
  }
  if (!productColumns.quantityReceived) {
    await queryInterface.addColumn('products', 'quantityReceived', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await sequelize.query('UPDATE "products" SET "quantityReceived" = "quantityStock"');
  }
  if (!productColumns.status) {
    await queryInterface.addColumn('products', 'status', { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' });
  }
  await sequelize.query('ALTER TABLE "sales" ALTER COLUMN "clientId" DROP NOT NULL');
  await sequelize.query('ALTER TABLE "sales" ALTER COLUMN "staffId" DROP NOT NULL');
  await sequelize.query('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "clientName" VARCHAR(255)');
  await sequelize.query('ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT');
  console.log('Models synchronized');
};