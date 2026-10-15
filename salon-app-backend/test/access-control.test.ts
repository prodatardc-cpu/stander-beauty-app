import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { Attendance, Client, ReportArchive, Staff, User } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createStaffMember, localDate, workDay } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

describe('access control', () => {
  let server: TestServer;
  let admin: Account;
  let cashier: Account;
  let staff: Account;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    cashier = await createAccount('cashier');
    staff = await createAccount('staff');
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  test('protected routes refuse requests without a valid token', async () => {
    const id = randomUUID();
    const routes: [string, string][] = [
      ['GET', '/auth/me'], ['GET', '/auth/users'], ['PUT', '/auth/password'], ['GET', '/clients'], ['POST', '/clients'],
      ['DELETE', `/clients/${id}`], ['GET', `/commissions/staff/${id}`], ['POST', '/commissions/pay'], ['GET', '/sales'],
      ['POST', '/sales'], ['DELETE', `/sales/${id}`], ['GET', '/staff'], ['DELETE', `/staff/${id}`], ['GET', '/attendance?date=2026-10-12'],
      ['PUT', `/attendance/${workDay}`], ['GET', '/reports/overview'], ['POST', '/reports/close-day'], ['GET', '/route-that-does-not-exist'],
    ];
    for (const [method, path] of routes) {
      assert.equal((await server.request(method, path)).status, 401, `${method} ${path} without a token`);
      assert.equal((await server.request(method, path, { token: 'not-a-jwt' })).status, 401, `${method} ${path} with a malformed token`);
    }
  });

  test('forged, unsigned, revoked and disabled-account tokens are rejected', async () => {
    const claims = { id: admin.user.id, email: admin.user.email, role: 'admin', tokenVersion: 0 };
    const forged = jwt.sign(claims, 'another-secret-that-the-server-does-not-know');
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ ...claims, iat: Math.floor(Date.now() / 1000) })}.`;
    for (const token of [forged, unsigned]) {
      assert.equal((await server.request('GET', '/auth/users', { token })).status, 401);
    }

    assert.equal((await server.request('GET', '/auth/me', { token: cashier.token })).status, 200);
    await cashier.user.update({ authVersion: cashier.user.authVersion + 1 });
    assert.equal((await server.request('GET', '/auth/me', { token: cashier.token })).status, 401, 'revoked session');

    await staff.user.update({ status: 'inactive' });
    assert.equal((await server.request('GET', '/auth/me', { token: staff.token })).status, 401, 'disabled account');
  });

  test('sessions cannot be refreshed beyond their maximum age', async () => {
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    const stale = jwt.sign(
      { id: admin.user.id, email: admin.user.email, role: 'admin', tokenVersion: 0, sessionStart: tenDaysAgo },
      process.env.JWT_SECRET as string,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    assert.equal((await server.request('GET', '/auth/me', { token: stale })).status, 401);
  });

  test('team roles are refused on administrator-only routes, without side effects', async () => {
    const member = await createStaffMember();
    const client = await createClient();
    const id = randomUUID();
    const adminOnly: [string, string, unknown?][] = [
      ['GET', '/auth/users'],
      ['POST', '/auth/users', { email: 'new@example.com', password: 'password123', role: 'staff' }],
      ['PATCH', `/auth/users/${staff.user.id}`, { role: 'cashier' }],
      ['POST', '/staff', { name: 'Nouvelle', phone: '0990000001', position: 'Barbier' }],
      ['PATCH', `/staff/${member.id}`, { commissionRate: 90 }],
      ['DELETE', `/staff/${member.id}`],
      ['POST', '/products', { name: 'Gel', sku: 'GEL-1', priceBuy: 1, priceSell: 2, category: 'Soins' }],
      ['POST', '/services', { name: 'Tresses', price: 30, duration: 60, category: 'Coiffure' }],
      ['DELETE', `/clients/${client.id}`],
      ['DELETE', `/sales/${id}`],
      ['DELETE', '/sales/reset'],
      ['DELETE', `/expenses/${id}`],
      ['POST', '/commissions/pay', { staffId: member.id, amount: 10 }],
      ['GET', `/commissions/staff/${member.id}`],
      ['POST', '/reports/close-year', { year: 2025 }],
    ];
    for (const account of [cashier, staff]) {
      for (const [method, path, body] of adminOnly) {
        const response = await server.request(method, path, { token: account.token, body });
        assert.equal(response.status, 403, `${account.user.role} ${method} ${path}`);
      }
    }
    assert.ok(await Client.findByPk(client.id), 'client untouched');
    assert.equal(Number((await Staff.findByPk(member.id))?.commissionRate), 40, 'staff member untouched');
    assert.equal((await User.findByPk(staff.user.id))?.role, 'staff', 'account untouched');
  });

  test('attendance is readable by every role but recorded only by admin and cashier', async () => {
    const member = await createStaffMember();
    const entries = [{ staffId: member.id, status: 'present' }];

    for (const account of [admin, cashier, staff]) {
      assert.equal((await server.request('GET', `/attendance?date=${workDay}`, { token: account.token })).status, 200);
    }

    const refused = await server.request('PUT', `/attendance/${workDay}`, { token: staff.token, body: { entries } });
    assert.equal(refused.status, 403);
    assert.equal(await Attendance.count(), 0, 'nothing recorded by the refused request');

    const byCashier = await server.request('PUT', `/attendance/${workDay}`, { token: cashier.token, body: { entries } });
    assert.equal(byCashier.status, 200);
    const byAdmin = await server.request('PUT', `/attendance/${workDay}`, { token: admin.token, body: { entries: [{ staffId: member.id, status: 'absent' }] } });
    assert.equal(byAdmin.status, 200);
    assert.equal((await Attendance.findOne({ where: { staffId: member.id } }))?.status, 'absent');
  });

  test('a team member only reads the commissions and report of their own staff record', async () => {
    const own = await createStaffMember();
    const other = await createStaffMember();
    const linked = await createAccount('staff', { staffId: own.id });
    const range = 'startDate=2026-01-01&endDate=2026-12-31';

    for (const path of [`/commissions/staff/${own.id}`, `/commissions/staff/${own.id}/total`, `/reports/staff/${own.id}?${range}`]) {
      assert.equal((await server.request('GET', path, { token: linked.token })).status, 200, path);
      assert.equal((await server.request('GET', path, { token: cashier.token })).status, 403, `unlinked cashier ${path}`);
    }
    for (const path of [`/commissions/staff/${other.id}`, `/commissions/staff/${other.id}/total`, `/reports/staff/${other.id}?${range}`]) {
      assert.equal((await server.request('GET', path, { token: linked.token })).status, 403, path);
      assert.equal((await server.request('GET', path, { token: admin.token })).status, 200, `admin ${path}`);
    }
  });

  test('closing the day is reserved to admin and cashier', async () => {
    const date = localDate();
    assert.equal((await server.request('POST', '/reports/close-day', { token: staff.token, body: { date } })).status, 403);
    assert.equal(await ReportArchive.count(), 0);
    assert.equal((await server.request('POST', '/reports/close-day', { token: cashier.token, body: { date } })).status, 201);
  });

  test('the administrator links a team account to a single staff record', async () => {
    const member = await createStaffMember();
    const linkedResponse = await server.request('PATCH', `/auth/users/${staff.user.id}`, { token: admin.token, body: { staffId: member.id } });
    assert.equal(linkedResponse.status, 200);
    assert.equal(linkedResponse.body.staffId, member.id);

    const me = await server.request('GET', '/auth/me', { token: staff.token });
    assert.equal(me.body.user.staffId, member.id);

    const duplicate = await server.request('PATCH', `/auth/users/${cashier.user.id}`, { token: admin.token, body: { staffId: member.id } });
    assert.equal(duplicate.status, 409);
    assert.equal((await server.request('PATCH', `/auth/users/${cashier.user.id}`, { token: admin.token, body: { staffId: randomUUID() } })).status, 404);
    assert.equal((await server.request('PATCH', `/auth/users/${cashier.user.id}`, { token: admin.token, body: { staffId: 'nope' } })).status, 400);

    const unlinked = await server.request('PATCH', `/auth/users/${staff.user.id}`, { token: admin.token, body: { staffId: null } });
    assert.equal(unlinked.status, 200);
    assert.equal(unlinked.body.staffId, null);
  });
});
