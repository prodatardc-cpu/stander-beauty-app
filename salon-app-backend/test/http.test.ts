import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { checkConfiguration, parseCorsOrigins, parseTrustProxy } from '../src/config/env';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

describe('configuration parsing', () => {
  test('CORS_ORIGIN tolerates spaces and trailing slashes, and removes duplicates', () => {
    assert.deepEqual(
      parseCorsOrigins(' https://salon.example.com/ , https://preview.vercel.app,https://salon.example.com ,', true),
      ['https://salon.example.com', 'https://preview.vercel.app']
    );
  });

  test('CORS_ORIGIN rejects wildcards, paths, garbage and, in production, plain http or no value', () => {
    for (const value of ['*', 'https://salon.example.com/app', 'salon.example.com', 'ftp://salon.example.com']) {
      assert.throws(() => parseCorsOrigins(value, false), /CORS_ORIGIN/, value);
    }
    assert.throws(() => parseCorsOrigins('http://salon.example.com', true), /https/);
    assert.throws(() => parseCorsOrigins(undefined, true), /production/);
    assert.throws(() => parseCorsOrigins(' , ', true), /production/);
    assert.deepEqual(parseCorsOrigins('http://localhost:4173', true), ['http://localhost:4173'], 'local production preview');
    assert.deepEqual(parseCorsOrigins(undefined, false), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  });

  test('TRUST_PROXY accepts a hop count, a list or a boolean', () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
  });

  test('production refuses weak or placeholder secrets and an invalid token lifetime', () => {
    const production = {
      NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), DB_PASSWORD: 'a-real-password', CORS_ORIGIN: 'https://salon.example.com',
    };
    assert.deepEqual(checkConfiguration(production), []);
    assert.throws(() => checkConfiguration({ ...production, JWT_SECRET: 'short' }), /JWT_SECRET/);
    assert.throws(() => checkConfiguration({ ...production, JWT_SECRET: undefined }), /JWT_SECRET/);
    assert.throws(() => checkConfiguration({ ...production, DB_PASSWORD: 'change-me' }), /DB_PASSWORD/);
    assert.throws(() => checkConfiguration({ ...production, JWT_EXPIRE: 'forever' }), /JWT_EXPIRE/);
    assert.throws(() => checkConfiguration({ ...production, CORS_ORIGIN: undefined }), /CORS_ORIGIN/);
    assert.match(checkConfiguration({ ...production, INITIAL_ADMIN_PASSWORD: 'x' })[0], /INITIAL_ADMIN_PASSWORD/);
  });
});

describe('HTTP protections', () => {
  let server: TestServer;
  let token: string;

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    token = (await createAccount('admin')).token;
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  test('responses carry security headers and no framework banner', async () => {
    const response = await server.request('GET', '/health');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  test('only the configured web origin may call the API from a browser', async () => {
    const preflight = await server.request('OPTIONS', '/commissions/pay', {
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Idempotency-Key/);

    const foreign = await server.request('GET', '/health', { headers: { Origin: 'https://attacker.example' } });
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  });

  test('oversized and malformed bodies get a JSON error without stack trace', async () => {
    const oversized = await server.request('POST', '/clients', { token, body: { name: 'x'.repeat(110 * 1024), phone: '0990000000' } });
    assert.equal(oversized.status, 413);
    assert.deepEqual(oversized.body, { error: 'Request body is too large' });

    const malformed = await server.request('POST', '/clients', { token, body: '{"name": ', headers: { 'Content-Type': 'application/json' } });
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.body, { error: 'Invalid JSON body' });
  });

  test('unknown routes answer 404 in JSON once authenticated', async () => {
    const response = await server.request('GET', '/does-not-exist', { token });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Not found' });
  });
});
