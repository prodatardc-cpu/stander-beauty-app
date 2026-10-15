import { QueryTypes, type Sequelize, type SyncOptions, type Transaction, type Transactionable } from 'sequelize';
import {
  Appointment, Attendance, Client, Commission, Expense, Product, ReportArchive, Sale, SaleItem, Service, Staff, StockMovement, User,
} from '../models';

export type MigrationContext = { sequelize: Sequelize; transaction: Transaction };
export type Migration = { name: string; up: (context: MigrationContext) => Promise<void> };

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

// Drops every single-column foreign key on table.column, whatever its generated name.
const dropForeignKeys = async ({ sequelize, transaction }: MigrationContext, table: string, column: string) => {
  const constraints = await sequelize.query<{ conname: string }>(
    `SELECT c.conname FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.conrelid = to_regclass(:table) AND array_length(c.conkey, 1) = 1 AND a.attname = :column`,
    { replacements: { table, column }, type: QueryTypes.SELECT, transaction }
  );
  for (const { conname } of constraints) {
    await sequelize.query(`ALTER TABLE ${quote(table)} DROP CONSTRAINT ${quote(conname)}`, { transaction });
  }
};

type ForeignKey = { table: string; column: string; references: string; onDelete: 'RESTRICT' | 'SET NULL' };

// Recreates the foreign key of table.column. It is added NOT VALID, then validated when the existing
// rows allow it; otherwise it stays NOT VALID (still enforced for every new or modified row) and a
// warning asks for the legacy rows to be checked, instead of blocking the deployment.
const replaceForeignKey = async (context: MigrationContext, { table, column, references, onDelete }: ForeignKey) => {
  const { sequelize, transaction } = context;
  const name = `${table}_${column}_fkey`;
  await dropForeignKeys(context, table, column);
  await sequelize.query(
    `ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${quote(column)})
     REFERENCES ${quote(references)} ("id") ON UPDATE CASCADE ON DELETE ${onDelete} NOT VALID`,
    { transaction }
  );
  try {
    await sequelize.transaction({ transaction }, (savepoint) =>
      sequelize.query(`ALTER TABLE ${quote(table)} VALIDATE CONSTRAINT ${quote(name)}`, { transaction: savepoint }));
  } catch (error) {
    console.warn(`Constraint ${name} kept NOT VALID; check the existing rows of "${table}": ${error instanceof Error ? error.message : error}`);
  }
};

// Migrations are applied in this order, once each, inside their own transaction.
// Never edit a migration that may already have run somewhere: add a new one instead.
export const migrations: Migration[] = [
  {
    // Reproduces what the API used to do implicitly at every start (sequelize.sync + ad hoc ALTERs),
    // so existing databases are left as they are and empty databases get the original schema.
    name: '001-baseline',
    up: async ({ sequelize, transaction }) => {
      const run = (sql: string) => sequelize.query(sql, { transaction });
      // Creates missing tables only: sync() without `alter` never modifies an existing table.
      // sync() forwards its options, transaction included, to every query (SyncOptions' typings omit it).
      const syncOptions: SyncOptions & Transactionable = { transaction };
      for (const model of [User, Client, Staff, Service, Product, Sale, SaleItem, Commission, Attendance, Appointment, StockMovement, Expense, ReportArchive]) {
        await model.sync(syncOptions);
      }
      await run('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3)');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "exchangeRateUsed" DECIMAL(12, 4)');
      await run('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 5');
      const [quantityReceived] = await sequelize.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'quantityReceived'`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (!quantityReceived) {
        await run('ALTER TABLE "products" ADD COLUMN "quantityReceived" INTEGER NOT NULL DEFAULT 0');
        await run('UPDATE "products" SET "quantityReceived" = "quantityStock"');
      }
      await run(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) NOT NULL DEFAULT 'active'`);
      await run('ALTER TABLE "sales" ALTER COLUMN "clientId" DROP NOT NULL');
      await run('ALTER TABLE "sales" ALTER COLUMN "staffId" DROP NOT NULL');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "clientName" VARCHAR(255)');
      await run('ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT');
    },
  },
  {
    // A team account can be linked to one staff record, which gives it access to its own commissions.
    name: '002-user-staff-link',
    up: async (context) => {
      await context.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "users_staff_id_unique" ON "users" ("staffId") WHERE "staffId" IS NOT NULL',
        { transaction: context.transaction }
      );
      await replaceForeignKey(context, { table: 'users', column: 'staffId', references: 'staff', onDelete: 'SET NULL' });
    },
  },
  {
    // Clients and staff members with history are archived instead of deleted.
    name: '003-archive-clients-and-staff',
    up: async ({ sequelize, transaction }) => {
      await sequelize.query('ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ', { transaction });
      await sequelize.query('ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ', { transaction });
    },
  },
  {
    // Sales, sale lines, commissions and attendance can no longer disappear through a cascading
    // delete (or lose their client/staff link through SET NULL): such a delete now fails.
    name: '004-protect-financial-history',
    up: async (context) => {
      const foreignKeys = [
        { table: 'sales', column: 'clientId', references: 'clients' },
        { table: 'sales', column: 'staffId', references: 'staff' },
        { table: 'sale_items', column: 'saleId', references: 'sales' },
        { table: 'commissions', column: 'saleItemId', references: 'sale_items' },
        { table: 'commissions', column: 'staffId', references: 'staff' },
        { table: 'attendances', column: 'staffId', references: 'staff' },
      ];
      for (const foreignKey of foreignKeys) {
        await replaceForeignKey(context, { ...foreignKey, onDelete: 'RESTRICT' });
      }
    },
  },
  {
    // Every commission settlement is recorded once (idempotency key) and linked to what it paid.
    name: '005-commission-payments',
    up: async (context) => {
      const run = (sql: string) => context.sequelize.query(sql, { transaction: context.transaction });
      await run(`CREATE TABLE IF NOT EXISTS "commission_payments" (
        "id" UUID PRIMARY KEY,
        "staffId" UUID NOT NULL REFERENCES "staff" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        "amount" DECIMAL(12, 2) NOT NULL CHECK ("amount" >= 0),
        "requestedAmount" DECIMAL(12, 2) NOT NULL CHECK ("requestedAmount" > 0),
        "commissionCount" INTEGER NOT NULL CHECK ("commissionCount" > 0),
        "idempotencyKey" VARCHAR(100) NOT NULL UNIQUE,
        "paidByUserId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )`);
      await run('ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "paymentId" UUID');
      await replaceForeignKey(context, { table: 'commissions', column: 'paymentId', references: 'commission_payments', onDelete: 'RESTRICT' });
      await run('CREATE INDEX IF NOT EXISTS "commissions_staff_id_paid" ON "commissions" ("staffId", "paid")');
    },
  },
];
