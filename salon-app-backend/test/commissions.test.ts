import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { StaffPayout } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createService, createStaffMember } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

describe('commission payments', () => {
  let server: TestServer;
  let admin: Account;
  let staffId: string;

  const pay = (amount: number, key: string | null = randomUUID(), member = staffId, currency: unknown = 'USD') =>
    server.request('POST', '/commissions/pay', {
      token: admin.token,
      body: { staffId: member, amount, currency },
      headers: key === null ? {} : { 'Idempotency-Key': key },
    });

  // USD totals; the CDF ones stay at zero in these tests (checked once below).
  const totals = async () => (await server.request('GET', `/commissions/staff/${staffId}/total`, { token: admin.token })).body.USD;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  // Three services of 20 USD at 40 %: 24 USD of commissions earned.
  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    const cashier = await createAccount('cashier');
    const member = await createStaffMember({ commissionRate: 40 });
    const service = await createService({ price: 20 });
    staffId = member.id;
    for (let index = 0; index < 3; index += 1) {
      const sale = await server.request('POST', '/sales', {
        token: cashier.token,
        body: { paymentMethod: 'cash', currency: 'USD', staffId, items: [{ type: 'service', itemId: service.id, quantity: 1 }] },
      });
      assert.equal(sale.status, 201);
    }
    assert.deepEqual(await totals(), { total: 24, paid: 0, remaining: 24 });
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  test('simultaneous requests sharing one idempotency key pay only once', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 6 }, () => pay(24, key)));
    assert.ok(responses.every((response) => response.status === 200), JSON.stringify(responses.map((response) => response.status)));
    assert.equal(responses.filter((response) => !response.body.replayed).length, 1, 'exactly one request paid');
    assert.equal(new Set(responses.map((response) => response.body.paymentId)).size, 1, 'every replay returns the same payment');
    assert.equal(await StaffPayout.count(), 1);
    assert.deepEqual(await totals(), { total: 24, paid: 24, remaining: 0 });
  });

  test('simultaneous payments with different keys cannot pay more than is due', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => pay(24)));
    const succeeded = responses.filter((response) => response.status === 200);
    assert.equal(succeeded.length, 1, JSON.stringify(responses.map((response) => response.status)));
    assert.ok(responses.filter((response) => response.status !== 200).every((response) => response.status === 409));
    assert.equal(await StaffPayout.count(), 1);
    assert.deepEqual(await totals(), { total: 24, paid: 24, remaining: 0 });
  });

  test('repeating a payment replays it, and a reused key cannot pay something else', async () => {
    const key = randomUUID();
    const first = await pay(10, key);
    assert.equal(first.status, 200);
    assert.deepEqual([first.body.paid, first.body.remaining, first.body.replayed], [10, 14, false]);

    const retry = await pay(10, key);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true);
    assert.equal(retry.body.paymentId, first.body.paymentId);
    assert.deepEqual(await totals(), { total: 24, paid: 10, remaining: 14 }, 'the retry paid nothing more');

    assert.equal((await pay(14, key)).status, 409, 'same key, different amount');
    const otherMember = await createStaffMember();
    assert.equal((await pay(10, key, otherMember.id)).status, 409, 'same key, different staff member');

    assert.equal((await pay(15)).status, 409, 'more than what is due');
    const rest = await pay(14);
    assert.equal(rest.status, 200);
    assert.deepEqual(await totals(), { total: 24, paid: 24, remaining: 0 });
    assert.equal((await pay(5)).status, 409, 'nothing left to pay');
    assert.equal(await StaffPayout.count(), 2);
  });

  test('payment requests are validated', async () => {
    assert.equal((await pay(24, null)).status, 400, 'missing idempotency key');
    assert.equal((await pay(24, 'short')).status, 400, 'malformed idempotency key');
    for (const amount of [0, -5, 10.555, Number.NaN]) {
      assert.equal((await pay(amount)).status, 400, `amount ${amount}`);
    }
    assert.equal((await pay(24, randomUUID(), 'not-a-uuid')).status, 400);
    assert.equal((await pay(24, randomUUID(), randomUUID())).status, 404);
    for (const currency of [null, 'EUR', 'usd']) {
      assert.equal((await pay(24, randomUUID(), staffId, currency)).status, 400, `currency ${currency}`);
    }
    assert.equal((await pay(24, randomUUID(), staffId, 'CDF')).status, 409, 'no CDF commission to pay');
    const all = await server.request('GET', `/commissions/staff/${staffId}/total`, { token: admin.token });
    assert.deepEqual(all.body.CDF, { total: 0, paid: 0, remaining: 0 });
    assert.equal(await StaffPayout.count(), 0);
    assert.deepEqual(await totals(), { total: 24, paid: 0, remaining: 24 });
  });
});
