import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/config/database';
import { User } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import {
  createAccount, createClient, createProduct, createService, createStaffMember, defaultPassword, localDate, workDay,
} from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

// One hash per table of the whole database: any row added, changed or removed changes it.
const databaseFingerprint = async () => {
  const tables = await sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migrations' ORDER BY tablename`,
    { type: QueryTypes.SELECT }
  );
  const fingerprint: Record<string, string | null> = {};
  for (const { tablename } of tables) {
    const [row] = await sequelize.query<{ hash: string | null }>(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS hash FROM "${tablename}" AS t`,
      { type: QueryTypes.SELECT }
    );
    fingerprint[tablename] = row.hash;
  }
  return fingerprint;
};

describe('read-only viewer accounts', () => {
  let server: TestServer;
  let admin: Account;
  let viewer: Account;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    viewer = await createAccount('viewer');
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  // Records of every kind, so that each refused request below targets something that exists and
  // would have been changed by an account allowed to write.
  const seed = async () => {
    const member = await createStaffMember();
    const client = await createClient();
    const service = await createService();
    const product = await createProduct();
    const sale = await server.request('POST', '/sales', {
      token: admin.token,
      body: { clientId: client.id, staffId: member.id, paymentMethod: 'cash', amountPaid: 5, items: [{ type: 'service', itemId: service.id, quantity: 1 }] },
    });
    assert.equal(sale.status, 201);
    const expense = await server.request('POST', '/expenses', {
      token: admin.token, body: { description: 'Savon', category: 'Fournitures', amount: 3, paymentMethod: 'cash', currency: 'USD' },
    });
    assert.equal(expense.status, 201);
    const appointment = await server.request('POST', '/appointments', {
      token: admin.token, body: { clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    assert.equal(appointment.status, 201);
    const closure = await server.request('POST', '/reports/close-day', { token: admin.token, body: { date: localDate() } });
    assert.equal(closure.status, 201);
    const cashier = await createAccount('cashier');
    return {
      member, client, service, product, cashier,
      saleId: sale.body.id as string, expenseId: expense.body.id as string,
      appointmentId: appointment.body.id as string, archiveId: closure.body.archive.id as string,
    };
  };

  test('every business write is refused with 403 and leaves the database unchanged', async () => {
    const { member, client, service, product, cashier, saleId, expenseId, appointmentId, archiveId } = await seed();
    const key = { 'Idempotency-Key': 'viewer-attempt-0001' };
    const writes: [string, string, unknown?, Record<string, string>?][] = [
      ['POST', '/auth/users', { email: 'nouveau@example.com', password: 'password123', role: 'staff' }],
      ['PATCH', `/auth/users/${cashier.user.id}`, { role: 'staff' }],
      ['PUT', `/auth/users/${cashier.user.id}/password`, { newPassword: 'another-password' }],
      ['POST', '/clients', { name: 'Nouvelle cliente', phone: '+243990001111' }],
      ['PUT', `/clients/${client.id}`, { name: 'Renommée' }],
      ['DELETE', `/clients/${client.id}`],
      ['POST', `/clients/${client.id}/restore`],
      ['POST', '/commissions/pay', { staffId: member.id, amount: 1, currency: 'USD' }, key],
      ['POST', '/sales', { paymentMethod: 'cash', items: [{ type: 'service', itemId: service.id, quantity: 1 }] }],
      ['POST', `/sales/${saleId}/payments`, { amount: 1, paymentMethod: 'cash' }, key],
      ['POST', `/sales/${saleId}/cancel`, { reason: 'test' }],
      ['DELETE', `/sales/${saleId}`],
      ['DELETE', '/sales/reset'],
      ['PUT', '/settings', { businessName: 'Autre nom' }],
      ['POST', '/staff', { name: 'Nouvelle', phone: '0990000001', position: 'Barbier' }],
      ['PATCH', `/staff/${member.id}`, { commissionRate: 90 }],
      ['DELETE', `/staff/${member.id}`],
      ['POST', `/staff/${member.id}/restore`],
      ['POST', '/expenses', { description: 'Gants', category: 'Fournitures', amount: 2, paymentMethod: 'cash', currency: 'USD' }],
      ['POST', `/expenses/${expenseId}/cancel`, { reason: 'test' }],
      ['DELETE', `/expenses/${expenseId}`],
      ['PUT', `/attendance/${workDay}`, { entries: [{ staffId: member.id, status: 'present' }] }],
      ['POST', '/products', { name: 'Gel', sku: 'GEL-1', priceBuy: 1, priceSell: 2, category: 'Soins' }],
      ['POST', `/products/${product.id}/stock`, { quantity: 5 }],
      ['POST', `/products/${product.id}/adjust`, { quantity: 1, note: 'Inventaire' }],
      ['PATCH', `/products/${product.id}`, { priceSell: 99 }],
      ['DELETE', `/products/${product.id}`],
      ['POST', '/services', { name: 'Tresses', price: 30, duration: 60, category: 'Coiffure' }],
      ['PATCH', `/services/${service.id}`, { price: 99 }],
      ['POST', '/appointments', { clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }],
      ['PATCH', `/appointments/${appointmentId}`, { status: 'cancelled' }],
      ['DELETE', `/appointments/${appointmentId}`],
      ['DELETE', `/reports/archives/${archiveId}`],
      ['POST', '/reports/close-day', { date: localDate() }],
      ['POST', '/reports/close-year', { year: 2025 }],
      ['POST', '/cash/adjustments', { direction: 'in', amount: 10, currency: 'USD', reason: 'Fonds de caisse' }],
      ['POST', '/cash/counts', { currency: 'USD', countedAmount: 10 }],
      ['POST', `/payroll/${member.id}/payouts`, { kind: 'advance', amount: 1, currency: 'USD' }, key],
      // Same routes reached with a trailing slash or a query string.
      ['POST', '/sales/', { paymentMethod: 'cash', items: [{ type: 'service', itemId: service.id, quantity: 1 }] }],
      ['POST', '/expenses?force=true', { description: 'Gants', category: 'Fournitures', amount: 2, paymentMethod: 'cash', currency: 'USD' }],
    ];

    const before = await databaseFingerprint();
    for (const [method, path, body, headers] of writes) {
      const response = await server.request(method, path, { token: viewer.token, body, headers });
      assert.equal(response.status, 403, `viewer ${method} ${path}`);
      assert.equal(response.body.error, 'Read-only account', `viewer ${method} ${path}`);
    }
    assert.deepEqual(await databaseFingerprint(), before, 'no row added, changed or removed');

    // The same requests are accepted from the administrator (a few of them, as a control).
    assert.equal((await server.request('PATCH', `/services/${service.id}`, { token: admin.token, body: { price: 25 } })).status, 200);
  });

  test('the viewer reads everything the administrator reads', async () => {
    const { member, client, service, product } = await seed();
    const range = `startDate=${localDate()}&endDate=${localDate()}`;
    const reads = [
      '/auth/me', '/settings', '/staff', '/staff?includeArchived=true', '/clients', '/clients/search?q=Client', `/clients/${client.id}`,
      '/sales', '/sales?status=refunded', `/sales/client/${client.id}`, '/expenses', `/attendance?date=${workDay}`,
      '/products', `/products/${product.id}/movements`, '/services', '/appointments',
      '/reports/overview', '/reports/archives', `/reports/period?${range}`, `/reports/attendance?${range}`, `/reports/sales?${range}`,
      `/reports/cash?${range}`, '/reports/debts', `/reports/team?${range}`, `/reports/staff/${member.id}?${range}`,
      `/reports/services/${service.id}?${range}`, `/reports/products/${product.id}?${range}`,
      '/history/days', `/history/days/${localDate()}`, '/payroll', `/payroll/${member.id}`,
      `/commissions/staff/${member.id}`, `/commissions/staff/${member.id}/total`,
    ];
    for (const path of reads) {
      const response = await server.request('GET', path, { token: viewer.token });
      assert.equal(response.status, 200, `viewer GET ${path}`);
    }
    const sale = (await server.request('GET', '/sales', { token: viewer.token })).body[0];
    assert.equal((await server.request('GET', `/sales/${sale.id}`, { token: viewer.token })).status, 200);
    assert.equal((await server.request('HEAD', '/products', { token: viewer.token })).status, 200);
    // User management stays with the administrator.
    assert.equal((await server.request('GET', '/auth/users', { token: viewer.token })).status, 403);
  });

  test('stock movements are readable by the administrator and the viewer only', async () => {
    const product = await createProduct();
    const cashier = await createAccount('cashier');
    const staff = await createAccount('staff');
    for (const account of [admin, viewer]) {
      assert.equal((await server.request('GET', `/products/${product.id}/movements`, { token: account.token })).status, 200);
    }
    for (const account of [cashier, staff]) {
      assert.equal((await server.request('GET', `/products/${product.id}/movements`, { token: account.token })).status, 403);
    }
  });

  test('the viewer signs in, changes its own password and closes its sessions', async () => {
    const login = await server.request('POST', '/auth/login', { body: { email: viewer.user.email, password: defaultPassword } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'viewer');

    const changed = await server.request('PUT', '/auth/password', {
      token: login.body.token, body: { currentPassword: defaultPassword, newPassword: 'a-new-viewer-password' },
    });
    assert.equal(changed.status, 200);
    assert.equal((await server.request('GET', '/auth/me', { token: login.body.token })).status, 401, 'previous token revoked');

    const loggedOut = await server.request('POST', '/auth/logout-all', { token: changed.body.token });
    assert.equal(loggedOut.status, 200);
    assert.equal((await server.request('GET', '/auth/me', { token: changed.body.token })).status, 401, 'sessions closed');
    // Only those exact routes: another method on the same path is still refused.
    const relogin = await server.request('POST', '/auth/login', { body: { email: viewer.user.email, password: 'a-new-viewer-password' } });
    assert.equal((await server.request('POST', '/auth/password', { token: relogin.body.token, body: {} })).status, 403);
  });

  test('the administrator creates an Observateur account and can switch a role to it', async () => {
    const created = await server.request('POST', '/auth/users', {
      token: admin.token, body: { email: 'observateur@example.com', password: 'password123', role: 'viewer' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.role, 'viewer');
    assert.equal((await User.findOne({ where: { email: 'observateur@example.com' } }))?.role, 'viewer');

    const cashier = await createAccount('cashier');
    const switched = await server.request('PATCH', `/auth/users/${cashier.user.id}`, { token: admin.token, body: { role: 'viewer' } });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.role, 'viewer');
    // From now on the account only reads.
    const refused = await server.request('POST', '/expenses', {
      token: cashier.token, body: { description: 'Gants', category: 'Fournitures', amount: 2, paymentMethod: 'cash', currency: 'USD' },
    });
    assert.equal(refused.status, 403);

    assert.equal((await server.request('POST', '/auth/users', {
      token: admin.token, body: { email: 'chef@example.com', password: 'password123', role: 'admin' },
    })).status, 400, 'the administrator stays unique');
  });
});
