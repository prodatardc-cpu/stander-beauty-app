import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { ActivityEvent, Sale } from '../src/models';
import { clearActivityBuffer, flushActivity, type RealtimeEvent } from '../src/services/realtime';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import {
  createAccount, createClient, createProduct, createService, createStaffMember, localDate, workDay,
} from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

// Collects the events a connected account receives.
type Listener = { socket: Socket; events: RealtimeEvent[] };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('real-time events', () => {
  let server: TestServer;
  let admin: Account;
  let viewer: Account;
  const sockets: Socket[] = [];

  const open = (token: string | undefined) => {
    const socket = connect(server.origin, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    return socket;
  };

  const listen = async (token: string): Promise<Listener> => {
    const socket = open(token);
    const events: RealtimeEvent[] = [];
    socket.on('activity', (event: RealtimeEvent) => events.push(event));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return { socket, events };
  };

  const waitFor = async (listener: Listener, type: string, timeout = 3000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const event = listener.events.find((entry) => entry.type === type);
      if (event) return event;
      await delay(20);
    }
    assert.fail(`no ${type} event received`);
  };

  before(async () => {
    await prepareDatabase();
    server = await startTestServer(undefined, { realtime: true });
  });

  beforeEach(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await resetDatabase();
    admin = await createAccount('admin');
    viewer = await createAccount('viewer');
  });

  after(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await server.close();
    await closeDatabase();
  });

  test('connections need a valid token of an active account', async () => {
    const refused = async (token: string | undefined) => {
      const socket = open(token);
      const error = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
      assert.equal(error.message, 'Unauthorized');
    };
    await refused(undefined);
    await refused('not-a-jwt');
    const blocked = await createAccount('cashier', { status: 'inactive' });
    await refused(blocked.token);
    const revoked = await createAccount('cashier');
    await revoked.user.update({ authVersion: revoked.user.authVersion + 1 });
    await refused(revoked.token);

    const accepted = await listen(viewer.token);
    assert.equal(accepted.socket.connected, true);
  });

  test('a sale is announced once committed, with its summary, amount, currency and author', async () => {
    const listener = await listen(viewer.token);
    const service = await createService({ price: 25 });
    const product = await createProduct({ quantityStock: 1, quantityReceived: 1, lowStockThreshold: 0, priceSell: 10 });
    const created = await server.request('POST', '/sales', {
      token: admin.token,
      body: { paymentMethod: 'cash', items: [{ type: 'service', itemId: service.id, quantity: 1 }, { type: 'product', itemId: product.id, quantity: 1 }] },
    });
    assert.equal(created.status, 201);

    const event = await waitFor(listener, 'sale.created');
    assert.equal(event.entity, 'sale');
    assert.equal(event.entityId, created.body.id);
    assert.equal(event.amount, 35);
    assert.equal(event.currency, 'USD');
    assert.equal(event.day, localDate());
    assert.deepEqual(event.actor, { email: admin.user.email, role: 'admin' });
    assert.equal(event.summary, `Vente n°${created.body.receiptNumber} encaissée – 35 USD`);
    assert.match(event.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(event.at)));
    // Committed before being announced: the sale can be read as soon as the event arrives.
    assert.ok(await Sale.findByPk(event.entityId!));

    const alert = await waitFor(listener, 'stock.alert');
    assert.equal(alert.entityId, product.id);
    assert.match(alert.summary, /^Rupture de stock : /);
  });

  test('a refused or failed write announces nothing', async () => {
    const listener = await listen(viewer.token);
    const product = await createProduct({ quantityStock: 0, quantityReceived: 0 });
    const failed = await server.request('POST', '/sales', {
      token: admin.token, body: { paymentMethod: 'cash', items: [{ type: 'product', itemId: product.id, quantity: 1 }] },
    });
    assert.equal(failed.status, 400);
    const refused = await server.request('POST', '/expenses', {
      token: viewer.token, body: { description: 'Gants', category: 'Fournitures', amount: 2, paymentMethod: 'cash', currency: 'USD' },
    });
    assert.equal(refused.status, 403);
    await delay(200);
    await flushActivity();
    assert.deepEqual(listener.events, []);
    assert.equal(await ActivityEvent.count(), 0);
  });

  test('cash and pay events only reach the accounts allowed to read them', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const cashier = await createAccount('cashier');
    const ownStaff = await createAccount('staff', { staffId: member.id });
    const otherStaff = await createAccount('staff', { staffId: other.id });
    const [toViewer, toCashier, toOwn, toOther] = await Promise.all([viewer, cashier, ownStaff, otherStaff].map((account) => listen(account.token)));

    assert.equal((await server.request('POST', '/cash/adjustments', {
      token: admin.token, body: { direction: 'in', amount: 10, currency: 'USD', reason: 'Fonds de caisse' },
    })).status, 201);
    assert.equal((await server.request('POST', `/payroll/${member.id}/payouts`, {
      token: admin.token, headers: { 'Idempotency-Key': 'advance-test-0001' }, body: { kind: 'advance', amount: 5, currency: 'USD' },
    })).status, 201);
    // A replayed payout is not announced again.
    assert.equal((await server.request('POST', `/payroll/${member.id}/payouts`, {
      token: admin.token, headers: { 'Idempotency-Key': 'advance-test-0001' }, body: { kind: 'advance', amount: 5, currency: 'USD' },
    })).status, 200);

    const cash = await waitFor(toViewer, 'cash.adjustment');
    assert.equal(cash.summary, 'Entrée de caisse : Fonds de caisse – 10 USD');
    await waitFor(toCashier, 'cash.adjustment');
    await waitFor(toViewer, 'payroll.payout');
    const own = await waitFor(toOwn, 'payroll.payout');
    assert.match(own.summary, /^Avance versée à /);
    await delay(200);
    assert.equal(toViewer.events.filter((event) => event.type === 'payroll.payout').length, 1);
    assert.equal(toCashier.events.some((event) => event.type === 'payroll.payout'), false, 'cashier does not read team pay');
    assert.equal(toOwn.events.some((event) => event.type === 'cash.adjustment'), false, 'staff does not read the cash journal');
    assert.equal(toOther.events.length, 0, 'another member receives neither');

    // The catch-up route applies the same rules.
    const types = async (account: Account) =>
      ((await server.request('GET', '/activity', { token: account.token })).body.events as RealtimeEvent[]).map((event) => event.type).sort();
    assert.deepEqual(await types(viewer), ['cash.adjustment', 'payroll.payout']);
    assert.deepEqual(await types(cashier), ['cash.adjustment']);
    assert.deepEqual(await types(ownStaff), ['payroll.payout']);
    assert.deepEqual(await types(otherStaff), []);
  });

  test('GET /activity returns what happened since a date, newest first, and survives the in-memory buffer', async () => {
    const first = await server.request('POST', '/clients', { token: admin.token, body: { name: 'Awa', phone: '+243990000101' } });
    await delay(20);
    const since = new Date().toISOString();
    await delay(20);
    await server.request('POST', '/clients', { token: admin.token, body: { name: 'Bijou', phone: '+243990000102' } });
    await server.request('PUT', `/clients/${first.body.id}`, { token: admin.token, body: { name: 'Awa M.' } });
    await flushActivity();

    const all = await server.request('GET', '/activity', { token: viewer.token });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.events.map((event: RealtimeEvent) => event.summary), [
      'Fiche client modifiée : Awa M.', 'Nouveau client : Bijou', 'Nouveau client : Awa',
    ]);
    const recent = await server.request('GET', `/activity?since=${encodeURIComponent(since)}`, { token: viewer.token });
    assert.deepEqual(recent.body.events.map((event: RealtimeEvent) => event.type), ['client.updated', 'client.created']);
    assert.equal((await server.request('GET', '/activity?limit=1', { token: viewer.token })).body.events.length, 1);

    // Persisted: still listed once the memory of the process is gone.
    assert.equal(await ActivityEvent.count(), 3);
    clearActivityBuffer();
    assert.equal((await server.request('GET', '/activity', { token: viewer.token })).body.events.length, 3);

    for (const query of ['since=yesterday', 'limit=0', 'limit=500', 'limit=abc']) {
      assert.equal((await server.request('GET', `/activity?${query}`, { token: viewer.token })).status, 400, query);
    }
    assert.equal((await server.request('GET', '/activity')).status, 401);
  });

  test('closing every session disconnects the account’s connections', async () => {
    const listener = await listen(viewer.token);
    const disconnected = new Promise<string>((resolve) => listener.socket.once('disconnect', resolve));
    assert.equal((await server.request('POST', '/auth/logout-all', { token: viewer.token })).status, 200);
    assert.equal(await disconnected, 'io server disconnect');

    const again = open(viewer.token);
    const error = await new Promise<Error>((resolve) => again.once('connect_error', resolve));
    assert.equal(error.message, 'Unauthorized', 'the revoked token cannot reconnect');
  });

  test('every write of the web app announces its change', async () => {
    const listener = await listen(viewer.token);
    const asAdmin = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
      const response = await server.request(method, path, { token: admin.token, body, headers });
      assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
      return response.body;
    };

    const client = await asAdmin('POST', '/clients', { name: 'Clarisse', phone: '+243990000201' });
    await asAdmin('PUT', `/clients/${client.id}`, { notes: 'Préfère le matin' });
    const member = await asAdmin('POST', '/staff', { name: 'Aline', phone: '0990000002', position: 'Coiffeuse' });
    await asAdmin('PATCH', `/staff/${member.id}`, { commissionRate: 35 });
    const service = await asAdmin('POST', '/services', { name: 'Brushing', price: 20, duration: 45, category: 'Coiffure' });
    await asAdmin('PATCH', `/services/${service.id}`, { price: 22 });
    const product = await asAdmin('POST', '/products', { name: 'Huile', sku: 'HUI-1', priceBuy: 2, priceSell: 6, category: 'Soins', quantityStock: 3, lowStockThreshold: 1 });
    await asAdmin('PATCH', `/products/${product.id}`, { priceSell: 7 });
    await asAdmin('POST', `/products/${product.id}/stock`, { quantity: 2 });
    await asAdmin('POST', `/products/${product.id}/adjust`, { quantity: 1, note: 'Casse' });
    const unused = await createProduct({ quantityStock: 0, quantityReceived: 0 });
    await asAdmin('DELETE', `/products/${unused.id}`);

    const sale = await asAdmin('POST', '/sales', {
      clientId: client.id, staffId: member.id, paymentMethod: 'cash', amountPaid: 10, items: [{ type: 'service', itemId: service.id, quantity: 1 }],
    });
    await asAdmin('POST', `/sales/${sale.id}/payments`, { amount: 5, paymentMethod: 'momo' });
    const other = await asAdmin('POST', '/sales', { paymentMethod: 'cash', items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    await asAdmin('POST', `/sales/${other.id}/cancel`, { reason: 'Erreur de saisie' });
    const expense = await asAdmin('POST', '/expenses', { description: 'Serviettes', category: 'Fournitures', amount: 4, paymentMethod: 'cash', currency: 'USD' });
    await asAdmin('POST', `/expenses/${expense.id}/cancel`, { reason: 'Doublon' });

    const appointment = await asAdmin('POST', '/appointments', {
      clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await asAdmin('PATCH', `/appointments/${appointment.id}`, { status: 'confirmed' });
    await asAdmin('DELETE', `/appointments/${appointment.id}`);
    const teammate = await createStaffMember();
    await asAdmin('PUT', `/attendance/${workDay}`, { entries: [{ staffId: member.id, status: 'present' }, { staffId: teammate.id, status: 'absent' }] });

    await asAdmin('POST', '/cash/adjustments', { direction: 'out', amount: 3, currency: 'USD', reason: 'Monnaie' });
    await asAdmin('POST', '/cash/counts', { currency: 'USD', countedAmount: 12 });
    await asAdmin('POST', `/payroll/${member.id}/payouts`, { kind: 'advance', amount: 2, currency: 'USD' }, { 'Idempotency-Key': 'every-write-0001' });
    const closure = await asAdmin('POST', '/reports/close-day', { date: localDate() });
    await asAdmin('POST', '/reports/close-year', { year: 2025 });
    await asAdmin('DELETE', `/reports/archives/${closure.archive.id}`);
    await asAdmin('PUT', '/settings', { businessName: 'Stander Beauty Gombe' });

    await asAdmin('DELETE', `/clients/${client.id}`);
    await asAdmin('POST', `/clients/${client.id}/restore`);
    await asAdmin('DELETE', `/staff/${member.id}`);
    await asAdmin('POST', `/staff/${member.id}/restore`);
    await asAdmin('DELETE', '/sales/reset');

    const expected = [
      'sale.created', 'sale.payment_added', 'sale.cancelled', 'sales.reset',
      'expense.created', 'expense.cancelled',
      'appointment.created', 'appointment.updated', 'appointment.deleted',
      'client.created', 'client.updated', 'client.archived', 'client.restored',
      'staff.created', 'staff.updated', 'staff.archived', 'staff.restored',
      'attendance.saved',
      'product.created', 'product.updated', 'product.deleted', 'product.stock_received', 'product.stock_adjusted', 'stock.alert',
      'service.created', 'service.updated',
      'cash.adjustment', 'cash.count', 'payroll.payout',
      'day.closed', 'year.closed', 'archive.deleted', 'settings.updated',
    ];
    await waitFor(listener, 'sales.reset');
    await flushActivity();
    const received = new Set(listener.events.map((event) => event.type));
    assert.deepEqual(expected.filter((type) => !received.has(type)), [], 'missing live events');
    const journal = new Set(((await server.request('GET', '/activity', { token: viewer.token })).body.events as RealtimeEvent[]).map((event) => event.type));
    assert.deepEqual(expected.filter((type) => !journal.has(type)), [], 'missing journal entries');

    const summaries = listener.events.map((event) => event.summary);
    assert.ok(summaries.includes('Inventaire : Huile 5 → 1 (Casse)'));
    assert.ok(summaries.includes('Stock bas : Huile (1 restant)'));
    assert.ok(summaries.some((summary) => /^Dette réglée – vente n°\d+ : 5 USD \(reste dû 7 USD\)$/.test(summary)), summaries.join('\n'));
    assert.ok(summaries.some((summary) => /^Rendez-vous confirmé : Brushing – Clarisse avec Aline, /.test(summary)));
    assert.ok(summaries.includes('Paramètres modifiés : coordonnées de l’établissement'));
  });
});
