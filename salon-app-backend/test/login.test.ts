import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, defaultPassword } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

describe('sign-in brute-force protection', () => {
  // A fresh server, hence fresh counters, for every test.
  let server: TestServer;
  let email: string;

  const login = (password: string, account = email) =>
    server.request('POST', '/auth/login', { body: { email: account, password } });

  before(prepareDatabase);

  beforeEach(async () => {
    await resetDatabase();
    email = (await createAccount('cashier')).user.email;
    server = await startTestServer();
  });

  afterEach(() => server.close());
  after(closeDatabase);

  test('after 5 failures the account is locked for this address, even with the right password', async () => {
    assert.equal((await login(defaultPassword)).status, 200);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await login('wrong password');
      assert.equal(response.status, 401, `attempt ${attempt}`);
      assert.deepEqual(response.body, { error: 'Invalid credentials' });
    }
    const locked = await login(defaultPassword);
    assert.equal(locked.status, 429);
    assert.deepEqual(locked.body, { error: 'Too many login attempts' });
    const retryAfter = Number(locked.headers.get('retry-after'));
    assert.ok(retryAfter > 0 && retryAfter <= 15 * 60, `Retry-After: ${retryAfter}`);
  });

  test('unknown and disabled accounts get exactly the same answers as existing ones', async () => {
    const disabled = (await createAccount('staff', { status: 'inactive' })).user.email;
    const transcripts: string[] = [];
    for (const account of [email, 'nobody@example.com', disabled]) {
      const answers = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await login(account === disabled ? defaultPassword : 'wrong password', account);
        answers.push([response.status, response.body, response.headers.has('retry-after')]);
      }
      transcripts.push(JSON.stringify(answers));
    }
    assert.equal(new Set(transcripts).size, 1, transcripts.join('\n'));
    assert.match(transcripts[0], /^\[\[401,.*\[429,\{"error":"Too many login attempts"\},true\]\]$/);
  });

  test('a burst of parallel attempts cannot exceed the limit', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => login('wrong password')));
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 401).length, 5, JSON.stringify(statuses));
    assert.equal(statuses.filter((status) => status === 429).length, 15);
  });

  test('one address cannot spray passwords across many accounts', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      assert.equal((await login('wrong password', `target-${attempt}@example.com`)).status, 401);
    }
    assert.equal((await login(defaultPassword)).status, 429, 'the address is now blocked for every account');
  });

  test('a successful sign-in clears the failures of this address for the account', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await login('wrong password')).status, 401);
    assert.equal((await login(defaultPassword)).status, 200);
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login('wrong password')).status, 401);
    assert.equal((await login('wrong password')).status, 429);
  });

  test('malformed requests are rejected without being counted as failures', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal((await server.request('POST', '/auth/login', { body: { email, password: { $gt: '' } } })).status, 400);
    }
    assert.equal((await login(defaultPassword)).status, 200);
  });
});
