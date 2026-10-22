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
  {
    // Makes the data consistent across devices and currencies:
    // - salon_settings: base currency and USD/CDF rate shared by every device (were kept per browser);
    // - commissions, their payments and expenses record their currency and are totalled per currency.
    //   Rows recorded before this migration take the currency of their sale when it is known,
    //   otherwise USD (the API's and the web app's default until now);
    // - services keep their audience and women/men prices, sale lines the audience charged;
    // - staff keep their pay type (commission or fixed salary) and monthly salary;
    // - sales keep their total in the base currency, which is what the client's total adds up;
    // - report archives keep their figures per currency.
    name: '006-currencies-and-consistent-catalog',
    up: async ({ sequelize, transaction }) => {
      const run = (sql: string) => sequelize.query(sql, { transaction });
      const currencyCheck = (table: string, column = 'currency') =>
        run(`ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(`${table}_${column}_check`)} CHECK (${quote(column)} IN ('USD', 'CDF'))`);

      await run(`CREATE TABLE IF NOT EXISTS "salon_settings" (
        "id" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
        "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK ("baseCurrency" IN ('USD', 'CDF')),
        "usdToCdfRate" DECIMAL(12, 4) CHECK ("usdToCdfRate" > 0),
        "updatedByUserId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await run('INSERT INTO "salon_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING');

      await run('ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3)');
      await run(`UPDATE "commissions" AS c SET "currency" = s."currency"
        FROM "sale_items" AS i JOIN "sales" AS s ON s."id" = i."saleId"
        WHERE c."saleItemId" = i."id" AND c."currency" IS NULL AND s."currency" IN ('USD', 'CDF')`);
      await run(`UPDATE "commissions" SET "currency" = 'USD' WHERE "currency" IS NULL`);
      await run('ALTER TABLE "commissions" ALTER COLUMN "currency" SET NOT NULL');
      await currencyCheck('commissions');
      await run('CREATE INDEX IF NOT EXISTS "commissions_staff_id_currency_paid" ON "commissions" ("staffId", "currency", "paid")');

      await run('ALTER TABLE "commission_payments" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3)');
      await run(`UPDATE "commission_payments" AS p SET "currency" = (SELECT MIN(c."currency") FROM "commissions" AS c WHERE c."paymentId" = p."id")
        WHERE p."currency" IS NULL`);
      await run(`UPDATE "commission_payments" SET "currency" = 'USD' WHERE "currency" IS NULL`);
      await run('ALTER TABLE "commission_payments" ALTER COLUMN "currency" SET NOT NULL');
      await currencyCheck('commission_payments');

      await run('ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3)');
      await run(`UPDATE "expenses" SET "currency" = 'USD' WHERE "currency" IS NULL`);
      await run('ALTER TABLE "expenses" ALTER COLUMN "currency" SET NOT NULL');
      await currencyCheck('expenses');

      await run(`ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "audience" VARCHAR(10) NOT NULL DEFAULT 'unisex'`);
      await run('ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "womenPrice" DECIMAL(10, 2)');
      await run('ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "menPrice" DECIMAL(10, 2)');
      await run(`ALTER TABLE "services" ADD CONSTRAINT "services_audience_check" CHECK ("audience" IN ('women', 'men', 'unisex'))`);
      await run('ALTER TABLE "services" ADD CONSTRAINT "services_audience_prices_check" CHECK ("womenPrice" >= 0 AND "menPrice" >= 0)');
      await run('ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "audience" VARCHAR(10)');
      await run(`ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_audience_check" CHECK ("audience" IN ('women', 'men'))`);

      await run(`ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "payType" VARCHAR(20) NOT NULL DEFAULT 'commission'`);
      await run('ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "monthlySalary" DECIMAL(12, 2) NOT NULL DEFAULT 0');
      await run(`ALTER TABLE "staff" ADD CONSTRAINT "staff_pay_type_check" CHECK ("payType" IN ('commission', 'fixed'))`);
      await run('ALTER TABLE "staff" ADD CONSTRAINT "staff_monthly_salary_check" CHECK ("monthlySalary" >= 0)');

      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "baseCurrency" VARCHAR(3)');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "baseAmount" DECIMAL(14, 2)');
      await run('ALTER TABLE "clients" ALTER COLUMN "totalSpent" TYPE DECIMAL(14, 2)');
      await run('ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "breakdown" JSONB');
    },
  },
  {
    // Traceable operations, for receipts, debts, the cash journal, team pay and the daily history:
    // - salon_settings: business details printed on receipts, remuneration period;
    // - sales: receipt number (sequence, numbered in order of creation), author, cancellation details;
    // - sale_items: name and purchase cost at the time of the sale;
    // - sale_payments: every amount received for a sale (existing sales: their initial payment);
    // - staff_payouts: advances and payments to the team (existing commission payments are copied);
    // - commissions and expenses are cancelled instead of deleted; cash_adjustments and cash_counts
    //   record the other cash movements and the drawer counts;
    // - appointments keep the price of their service at booking time.
    name: '007-operations-history',
    up: async ({ sequelize, transaction }) => {
      const run = (sql: string) => sequelize.query(sql, { transaction });
      const check = (table: string, name: string, condition: string) =>
        run(`ALTER TABLE ${quote(table)} ADD CONSTRAINT ${quote(name)} CHECK (${condition})`);

      await run(`ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "businessName" VARCHAR(120) NOT NULL DEFAULT 'Stander Beauty'`);
      await run('ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "businessEmail" VARCHAR(254)');
      await run('ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "businessPhone" VARCHAR(40)');
      await run('ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "taxId" VARCHAR(60)');
      await run('ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "businessAddress" VARCHAR(255)');
      await run(`ALTER TABLE "salon_settings" ADD COLUMN IF NOT EXISTS "payPeriod" VARCHAR(10) NOT NULL DEFAULT 'monthly'`);
      await check('salon_settings', 'salon_settings_pay_period_check', `"payPeriod" IN ('weekly', 'monthly')`);

      await run('ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "description" TEXT');

      await run('CREATE SEQUENCE IF NOT EXISTS "sales_receipt_number_seq"');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "receiptNumber" BIGINT');
      await run(`UPDATE "sales" AS s SET "receiptNumber" = n.rank FROM (
        SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rank FROM "sales") AS n
        WHERE s."id" = n."id" AND s."receiptNumber" IS NULL`);
      await run(`SELECT setval('sales_receipt_number_seq', GREATEST((SELECT COALESCE(MAX("receiptNumber"), 0) FROM "sales"), 1),
        (SELECT COUNT(*) > 0 FROM "sales"))`);
      await run(`ALTER TABLE "sales" ALTER COLUMN "receiptNumber" SET DEFAULT nextval('sales_receipt_number_seq')`);
      await run('ALTER TABLE "sales" ALTER COLUMN "receiptNumber" SET NOT NULL');
      await run('ALTER SEQUENCE "sales_receipt_number_seq" OWNED BY "sales"."receiptNumber"');
      await run('CREATE UNIQUE INDEX IF NOT EXISTS "sales_receipt_number_unique" ON "sales" ("receiptNumber")');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "createdByUserId" UUID');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cancelledByUserId" UUID');
      await run('ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cancelReason" VARCHAR(255)');
      // Sales cancelled before: their cancellation time is their last update.
      await run(`UPDATE "sales" SET "cancelledAt" = "updatedAt" WHERE "status" = 'refunded' AND "cancelledAt" IS NULL`);

      await run('ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "itemName" VARCHAR(255)');
      await run('ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(10, 2)');
      await run(`UPDATE "sale_items" AS i SET "itemName" = s."name" FROM "services" AS s
        WHERE i."type" = 'service' AND i."itemId" = s."id" AND i."itemName" IS NULL`);
      await run(`UPDATE "sale_items" AS i SET "itemName" = p."name" FROM "products" AS p
        WHERE i."type" = 'product' AND i."itemId" = p."id" AND i."itemName" IS NULL`);

      await run(`CREATE TABLE IF NOT EXISTS "sale_payments" (
        "id" UUID PRIMARY KEY,
        "saleId" UUID NOT NULL REFERENCES "sales" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('sale', 'debt')),
        "amount" DECIMAL(14, 2) NOT NULL CHECK ("amount" > 0),
        "currency" VARCHAR(3) NOT NULL CHECK ("currency" IN ('USD', 'CDF')),
        "paymentMethod" VARCHAR(20) NOT NULL,
        "idempotencyKey" VARCHAR(100) UNIQUE,
        "userId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )`);
      await run('CREATE INDEX IF NOT EXISTS "sale_payments_sale_id" ON "sale_payments" ("saleId")');
      await run('CREATE INDEX IF NOT EXISTS "sale_payments_created_at" ON "sale_payments" ("createdAt")');
      // Existing sales: the amount paid at the till. Sales without a known currency cannot enter
      // a per-currency cash journal and are left out of it.
      await run(`INSERT INTO "sale_payments" ("id", "saleId", "kind", "amount", "currency", "paymentMethod", "createdAt", "updatedAt")
        SELECT gen_random_uuid(), s."id", 'sale', s."amountPaid", s."currency", s."paymentMethod"::text, s."saleDate", s."saleDate"
        FROM "sales" AS s
        WHERE s."amountPaid" > 0 AND s."currency" IN ('USD', 'CDF')
          AND NOT EXISTS (SELECT 1 FROM "sale_payments" AS p WHERE p."saleId" = s."id")`);

      await run(`CREATE TABLE IF NOT EXISTS "staff_payouts" (
        "id" UUID PRIMARY KEY,
        "staffId" UUID NOT NULL REFERENCES "staff" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
        "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('advance', 'payment')),
        "amount" DECIMAL(14, 2) NOT NULL CHECK ("amount" > 0),
        "currency" VARCHAR(3) NOT NULL CHECK ("currency" IN ('USD', 'CDF')),
        "paymentMethod" VARCHAR(20) NOT NULL DEFAULT 'cash',
        "note" VARCHAR(255),
        "idempotencyKey" VARCHAR(100) NOT NULL UNIQUE,
        "paidByUserId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )`);
      await run('CREATE INDEX IF NOT EXISTS "staff_payouts_staff_id" ON "staff_payouts" ("staffId", "currency")');
      await run(`INSERT INTO "staff_payouts" ("id", "staffId", "kind", "amount", "currency", "note", "idempotencyKey", "paidByUserId", "createdAt", "updatedAt")
        SELECT p."id", p."staffId", 'payment', p."amount", p."currency", 'Règlement de commissions', p."idempotencyKey", p."paidByUserId", p."createdAt", p."updatedAt"
        FROM "commission_payments" AS p
        WHERE p."amount" > 0 AND NOT EXISTS (SELECT 1 FROM "staff_payouts" AS s WHERE s."idempotencyKey" = p."idempotencyKey")`);

      await run('ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ');

      await run('ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "createdByUserId" UUID');
      await run('ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ');
      await run('ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "cancelledByUserId" UUID');
      await run('ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "cancelReason" VARCHAR(255)');

      await run(`CREATE TABLE IF NOT EXISTS "cash_adjustments" (
        "id" UUID PRIMARY KEY,
        "direction" VARCHAR(3) NOT NULL CHECK ("direction" IN ('in', 'out')),
        "amount" DECIMAL(14, 2) NOT NULL CHECK ("amount" > 0),
        "currency" VARCHAR(3) NOT NULL CHECK ("currency" IN ('USD', 'CDF')),
        "paymentMethod" VARCHAR(20) NOT NULL DEFAULT 'cash',
        "reason" VARCHAR(255) NOT NULL,
        "userId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )`);
      await run(`CREATE TABLE IF NOT EXISTS "cash_counts" (
        "id" UUID PRIMARY KEY,
        "day" DATE NOT NULL,
        "currency" VARCHAR(3) NOT NULL CHECK ("currency" IN ('USD', 'CDF')),
        "expectedAmount" DECIMAL(14, 2) NOT NULL,
        "countedAmount" DECIMAL(14, 2) NOT NULL CHECK ("countedAmount" >= 0),
        "note" VARCHAR(255),
        "userId" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL
      )`);

      await run('ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "price" DECIMAL(10, 2)');
      await run('ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3)');
      await run(`UPDATE "appointments" AS a SET "price" = s."price", "currency" = (SELECT "baseCurrency" FROM "salon_settings" WHERE "id" = 1)
        FROM "services" AS s WHERE a."serviceId" = s."id" AND a."price" IS NULL`);
    },
  },
  {
    // - sale_items.catalogUnitPrice: the catalogue price of a service line whose price the cashier
    //   changed at the till (null when the catalogue price was charged);
    // - products.imageUrl becomes TEXT: it may hold a photo taken or chosen on the device.
    name: '008-till-prices-and-product-photos',
    up: async ({ sequelize, transaction }) => {
      await sequelize.query('ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "catalogUnitPrice" DECIMAL(10, 2)', { transaction });
      await sequelize.query('ALTER TABLE "products" ALTER COLUMN "imageUrl" TYPE TEXT', { transaction });
    },
  },
  {
    // Read-only "viewer" accounts (Observateur), used by the mobile follow-up app. users.role is a
    // PostgreSQL enum created by sequelize.sync (normally "enum_users_role"); its actual type is read
    // from the catalogue. ADD VALUE is accepted inside a transaction since PostgreSQL 12 (the value
    // only becomes usable once it commits, which is all that is needed here).
    name: '009-viewer-role',
    up: async ({ sequelize, transaction }) => {
      const [column] = await sequelize.query<{ typname: string; typtype: string }>(
        `SELECT t.typname, t.typtype FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
         WHERE a.attrelid = to_regclass('users') AND a.attname = 'role' AND NOT a.attisdropped`,
        { type: QueryTypes.SELECT, transaction }
      );
      // A text column (never created by this API) accepts the new value as it is.
      if (column?.typtype !== 'e') return;
      await sequelize.query(`ALTER TYPE ${quote(column.typname)} ADD VALUE IF NOT EXISTS 'viewer'`, { transaction });
    },
  },
  {
    // Journal of the changes broadcast in real time (services/realtime.ts), kept so that devices
    // catch up after a disconnection or a server restart (GET /activity). No foreign keys: an event
    // outlives the record it describes (deleted appointment, archived client…).
    name: '010-activity-events',
    up: async ({ sequelize, transaction }) => {
      const run = (sql: string) => sequelize.query(sql, { transaction });
      await run(`CREATE TABLE IF NOT EXISTS "activity_events" (
        "id" UUID PRIMARY KEY,
        "type" VARCHAR(60) NOT NULL,
        "entity" VARCHAR(40) NOT NULL,
        "entityId" VARCHAR(64),
        "at" TIMESTAMPTZ NOT NULL,
        "actorEmail" VARCHAR(254),
        "actorRole" VARCHAR(20),
        "summary" VARCHAR(255) NOT NULL,
        "currency" VARCHAR(3) CHECK ("currency" IN ('USD', 'CDF')),
        "amount" DECIMAL(14, 2),
        "day" VARCHAR(10),
        "audience" VARCHAR(10) NOT NULL CHECK ("audience" IN ('everyone', 'history', 'payroll')),
        "staffId" UUID
      )`);
      await run('CREATE INDEX IF NOT EXISTS "activity_events_at" ON "activity_events" ("at")');
    },
  },
];
