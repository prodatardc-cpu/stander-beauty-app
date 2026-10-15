import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listPendingMigrations, runMigrations } from '../src/db/migrator';
import { closeDatabase, prepareDatabase } from './helpers/db';
import { startTestServer, type TestServer } from './helpers/http';

describe('health checks and schema', () => {
  let server: TestServer;
  let degraded: TestServer;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
    degraded = await startTestServer({ checkDatabase: async () => { throw new Error('connection refused'); } });
  });

  after(async () => {
    await server.close();
    await degraded.close();
    await closeDatabase();
  });

  test('liveness answers without touching the database', async () => {
    const response = await degraded.request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
  });

  test('readiness reports a reachable database', async () => {
    const response = await server.request('GET', '/health/ready');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ready', database: 'up' });
  });

  test('readiness returns 503 without leaking the error when the database is down', async () => {
    const response = await degraded.request('GET', '/health/ready');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: 'unavailable', database: 'down' });
  });

  test('migrations are recorded and re-running them is a no-op', async () => {
    assert.deepEqual(await listPendingMigrations(), []);
    assert.deepEqual(await runMigrations(() => undefined), []);
  });
});
