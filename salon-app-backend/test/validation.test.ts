import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Appointment, Expense, Sale, Service, Staff } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createService, createStaffMember, workDay } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

describe('input validation', () => {
  let server: TestServer;
  let admin: Account;
  let staff: Account;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    staff = await createAccount('staff');
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  test('appointments only accept their editable fields and live references', async () => {
    const client = await createClient();
    const member = await createStaffMember();
    const service = await createService();
    const appointment = await Appointment.create({ clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date() });
    const otherClient = await createClient();
    const patch = (body: unknown) => server.request('PATCH', `/appointments/${appointment.id}`, { token: staff.token, body });

    assert.equal((await patch({ clientId: otherClient.id })).status, 400, 'cannot move the appointment to another client');
    assert.equal((await patch({ id: otherClient.id, status: 'confirmed' })).status, 400, 'cannot rewrite the identifier');
    assert.equal((await patch({ status: 'teleported' })).status, 400);
    assert.equal((await Appointment.findByPk(appointment.id))?.clientId, client.id);
    assert.equal((await patch({ status: 'confirmed' })).status, 200);

    const archivedClient = await createClient({ archivedAt: new Date() });
    const inactiveMember = await createStaffMember({ status: 'inactive' });
    const book = (body: Record<string, unknown>) => server.request('POST', '/appointments', {
      token: staff.token,
      body: { clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date().toISOString(), ...body },
    });
    assert.equal((await book({ clientId: archivedClient.id })).status, 400);
    assert.equal((await book({ staffId: inactiveMember.id })).status, 400);
    assert.equal((await book({ notes: 'x'.repeat(1001) })).status, 400);
    // Same member, same time as the confirmed appointment above: reported, then booked on confirmation.
    const overlapping = await book({});
    assert.equal(overlapping.status, 409);
    assert.equal(overlapping.body.conflict.id, appointment.id);
    const booked = await book({ allowOverlap: true });
    assert.equal(booked.status, 201);
    assert.deepEqual([Number(booked.body.price), booked.body.currency], [Number(service.price), 'USD'], 'price kept as booked');
    assert.equal((await book({ scheduledAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() })).status, 201, 'free slot');
  });

  test('staff and services reject out-of-range values and unknown fields', async () => {
    const createStaff = (body: Record<string, unknown>) => server.request('POST', '/staff', {
      token: admin.token, body: { name: 'Nadia', phone: '0990000002', position: 'Coiffeuse', ...body },
    });
    assert.equal((await createStaff({ commissionRate: 900 })).status, 400);
    assert.equal((await createStaff({ commissionRate: -1 })).status, 400);
    assert.equal((await createStaff({ photoUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await createStaff({ commissionRate: 35, payType: 'commission', monthlySalary: 0 })).status, 201, 'payload sent by the web app');

    const member = await createStaffMember();
    for (const body of [{ id: member.id.replace(/.$/, '0') }, { archivedAt: null }, { createdAt: '2020-01-01' }]) {
      assert.equal((await server.request('PATCH', `/staff/${member.id}`, { token: admin.token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await server.request('PATCH', `/staff/${member.id}`, { token: admin.token, body: { commissionRate: 45, payType: 'fixed' } })).status, 200);
    assert.equal(Number((await Staff.findByPk(member.id))?.commissionRate), 45);

    const service = await createService();
    assert.equal((await server.request('PATCH', `/services/${service.id}`, { token: admin.token, body: { id: member.id } })).status, 400);
    assert.equal((await server.request('PATCH', `/services/${service.id}`, { token: admin.token, body: { price: -5 } })).status, 400);
    const updated = await server.request('PATCH', `/services/${service.id}`, { token: admin.token, body: { price: 25, audience: 'unisex', womenPrice: null } });
    assert.equal(updated.status, 200);
    assert.equal(Number((await Service.findByPk(service.id))?.price), 25);
  });

  test('sales and expenses are bounded', async () => {
    const service = await createService();
    const sell = (items: unknown[]) => server.request('POST', '/sales', { token: staff.token, body: { paymentMethod: 'cash', items } });
    const line = { type: 'service', itemId: service.id, quantity: 1 };
    assert.equal((await sell(Array.from({ length: 101 }, () => line))).status, 400, 'too many lines');
    assert.equal((await sell([{ ...line, quantity: 1001 }])).status, 400, 'quantity too large');
    const notAnId = await sell([{ ...line, itemId: 'abc' }]);
    assert.equal(notAnId.status, 400, 'invalid item id is a client error, not a database error');
    assert.equal(await Sale.count(), 0);

    const spend = (body: Record<string, unknown>) => server.request('POST', '/expenses', {
      token: staff.token, body: { description: 'Gants', category: 'Fournitures', amount: 12.5, paymentMethod: 'cash', ...body },
    });
    assert.equal((await spend({ amount: 10.555 })).status, 400);
    assert.equal((await spend({ amount: 1e12 })).status, 400);
    assert.equal((await spend({ description: 'x'.repeat(256) })).status, 400);
    assert.equal((await spend({})).status, 201);
    assert.equal(await Expense.count(), 1);
  });

  test('malformed identifiers are answered 400 before reaching the database', async () => {
    const range = 'startDate=2026-01-01&endDate=2026-12-31';
    for (const [method, path] of [
      ['GET', `/reports/staff/abc?${range}`], ['GET', `/reports/services/abc?${range}`], ['DELETE', '/appointments/abc'],
      ['PATCH', '/products/abc'], ['GET', '/sales/client/abc'], ['GET', '/commissions/staff/abc'],
    ] as const) {
      const response = await server.request(method, path, { token: admin.token, body: method === 'PATCH' ? {} : undefined });
      assert.equal(response.status, 400, `${method} ${path}`);
    }
    const attendance = await server.request('PUT', `/attendance/${workDay}`, { token: admin.token, body: { entries: [{ staffId: 'abc', status: 'present' }] } });
    assert.equal(attendance.status, 400);
  });
});
