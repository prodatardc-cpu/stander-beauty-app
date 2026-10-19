import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Appointment, Client, Commission, Sale, SaleItem } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createService, createStaffMember } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

const historyCounts = async () => ({
  sales: await Sale.count(),
  saleItems: await SaleItem.count(),
  commissions: await Commission.count(),
  appointments: await Appointment.count(),
});

describe('client removal and validation', () => {
  let server: TestServer;
  let admin: Account;
  let cashier: Account;

  const recordSale = (body: Record<string, unknown>) =>
    server.request('POST', '/sales', { token: cashier.token, body: { paymentMethod: 'cash', currency: 'USD', ...body } });

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    cashier = await createAccount('cashier');
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  test('removing a client with history archives it and keeps sales, lines, commissions and appointments', async () => {
    const client = await createClient();
    const member = await createStaffMember();
    const service = await createService();
    const sale = await recordSale({ clientId: client.id, staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    assert.equal(sale.status, 201);
    await Appointment.create({ clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date() });
    const history = await historyCounts();
    assert.deepEqual(history, { sales: 1, saleItems: 1, commissions: 1, appointments: 1 });

    const removal = await server.request('DELETE', `/clients/${client.id}`, { token: admin.token });
    assert.equal(removal.status, 200);
    assert.equal(removal.body.outcome, 'archived');
    assert.ok((await Client.findByPk(client.id))?.archivedAt);
    assert.deepEqual(await historyCounts(), history);
    assert.equal((await Sale.findByPk(sale.body.id))?.clientId, client.id, 'the sale keeps its client');

    const listed = await server.request('GET', '/clients', { token: cashier.token });
    assert.ok(!listed.body.some((entry: { id: string }) => entry.id === client.id), 'hidden from the client list');
    const searched = await server.request('GET', `/clients/search?q=${encodeURIComponent(client.name)}`, { token: cashier.token });
    assert.equal(searched.body.length, 0, 'hidden from the search');
    const withArchived = await server.request('GET', '/clients?includeArchived=true', { token: cashier.token });
    assert.ok(withArchived.body.some((entry: { id: string }) => entry.id === client.id), 'still available to label past sales');

    const newSale = await recordSale({ clientId: client.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    assert.equal(newSale.status, 400, 'an archived client cannot buy');
    const samePhone = await server.request('POST', '/clients', { token: cashier.token, body: { name: 'Homonyme', phone: client.phone } });
    assert.equal(samePhone.status, 409);
    assert.equal(samePhone.body.error, 'Phone number belongs to an archived client');

    const again = await server.request('DELETE', `/clients/${client.id}`, { token: admin.token });
    assert.equal(again.body.outcome, 'archived', 'removing twice is harmless');
    assert.deepEqual(await historyCounts(), history);

    const restored = await server.request('POST', `/clients/${client.id}/restore`, { token: admin.token });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.archivedAt, null);
    assert.equal((await server.request('POST', `/clients/${client.id}/restore`, { token: cashier.token })).status, 403);
  });

  test('a client without any history is deleted for good', async () => {
    const client = await createClient();
    const removal = await server.request('DELETE', `/clients/${client.id}`, { token: admin.token });
    assert.equal(removal.status, 200);
    assert.equal(removal.body.outcome, 'deleted');
    assert.equal(await Client.findByPk(client.id), null);
    assert.equal((await server.request('DELETE', `/clients/${client.id}`, { token: admin.token })).status, 404);
  });

  test('the database itself refuses to delete a client or a sale that has history', async () => {
    const client = await createClient();
    const service = await createService();
    const sale = await recordSale({ clientId: client.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    assert.equal(sale.status, 201);
    // 23001 = restrict_violation (ON DELETE RESTRICT).
    // PostgreSQL reports a refused delete (ON DELETE RESTRICT or NO ACTION) as foreign_key_violation.
    const isRestrictViolation = (error: Error & { parent?: { code?: string } }) => error.parent?.code === '23503';
    await assert.rejects(Client.destroy({ where: { id: client.id } }), isRestrictViolation);
    await assert.rejects(Sale.destroy({ where: { id: sale.body.id } }), isRestrictViolation);
    assert.ok(await Client.findByPk(client.id));
    assert.equal(await SaleItem.count({ where: { saleId: sale.body.id } }), 1);
  });

  test('only the administrator adjusts loyalty points', async () => {
    const client = await createClient();
    const staff = await createAccount('staff');
    const refused = await server.request('PUT', `/clients/${client.id}`, { token: staff.token, body: { loyaltyPoints: 999 } });
    assert.equal(refused.status, 403);
    assert.equal((await Client.findByPk(client.id))?.loyaltyPoints, 0);
    const accepted = await server.request('PUT', `/clients/${client.id}`, { token: admin.token, body: { loyaltyPoints: 15 } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.loyaltyPoints, 15);
    assert.equal((await server.request('PUT', `/clients/${client.id}`, { token: admin.token, body: { loyaltyPoints: -3 } })).status, 400);
  });

  test('search matches the name or the phone and treats wildcards literally', async () => {
    const alice = await createClient({ name: 'Alice Mbala', phone: '+243811111111' });
    const bio = await createClient({ name: '100% Bio' });
    const search = async (q: string) =>
      (await server.request('GET', `/clients/search?q=${encodeURIComponent(q)}`, { token: cashier.token })).body.map((entry: { id: string }) => entry.id);
    assert.deepEqual(await search('alice'), [alice.id]);
    assert.deepEqual(await search('811111'), [alice.id]);
    assert.deepEqual(await search('%'), [bio.id]);
    assert.deepEqual(await search('_'), []);
    assert.equal((await server.request('GET', `/clients/search?q=${'x'.repeat(101)}`, { token: cashier.token })).status, 400);
  });

  test('client fields are validated', async () => {
    const invalidBodies = [
      { phone: '+243822222222' },
      { name: '   ', phone: '+243822222222' },
      { name: 'x'.repeat(121), phone: '+243822222222' },
      { name: 'Nom', phone: { $ne: null } },
      { name: 'Nom', phone: '+243822222222', notes: 'x'.repeat(2001) },
    ];
    for (const body of invalidBodies) {
      assert.equal((await server.request('POST', '/clients', { token: cashier.token, body })).status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(await Client.count(), 0);
    assert.equal((await server.request('GET', '/clients/not-a-uuid', { token: cashier.token })).status, 400);
  });
});
