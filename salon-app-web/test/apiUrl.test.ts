import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { developmentApiUrl, resolveApiUrl } from '../config/apiUrl.ts';

describe('API address resolution', () => {
  test('a production build without VITE_API_URL is refused with an explicit message', () => {
    for (const value of [undefined, '', '   ']) {
      assert.throws(() => resolveApiUrl({ VITE_API_URL: value }, { production: true }), /VITE_API_URL is required/);
    }
  });

  test('the development server falls back to the local API', () => {
    assert.equal(resolveApiUrl({}, { production: false }), developmentApiUrl);
  });

  test('production accepts https and same-origin paths, and refuses local or clear-text addresses', () => {
    assert.equal(resolveApiUrl({ VITE_API_URL: 'https://api.example.com/api/' }, { production: true }), 'https://api.example.com/api');
    assert.equal(resolveApiUrl({ VITE_API_URL: '/api' }, { production: true }), '/api');
    assert.throws(() => resolveApiUrl({ VITE_API_URL: 'http://api.example.com/api' }, { production: true }), /https/);
    for (const local of ['http://localhost:3000/api', 'http://127.0.0.1:3000/api', 'https://[::1]/api']) {
      assert.throws(() => resolveApiUrl({ VITE_API_URL: local }, { production: true }), /own computer/, local);
    }
    assert.equal(
      resolveApiUrl({ VITE_API_URL: 'http://localhost:3000/api', VITE_ALLOW_LOCAL_API: 'true' }, { production: true }),
      'http://localhost:3000/api',
      'explicit opt-in for a local preview'
    );
    for (const invalid of ['api.example.com', '//api.example.com', 'ftp://api.example.com']) {
      assert.throws(() => resolveApiUrl({ VITE_API_URL: invalid }, { production: true }), /VITE_API_URL/, invalid);
    }
  });
});

describe('production build', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const build = (env: Record<string, string>) => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'salon-web-build-'));
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
      // Variables set here take precedence over any local .env file.
      { cwd: root, env: { ...process.env, VITE_ALLOW_LOCAL_API: '', ...env }, encoding: 'utf8' }
    );
    return { ...result, outDir };
  };

  test('fails clearly when VITE_API_URL is missing', () => {
    const result = build({ VITE_API_URL: '' });
    rmSync(result.outDir, { recursive: true, force: true });
    assert.notEqual(result.status, 0, 'the build must fail');
    assert.match(`${result.stdout}${result.stderr}`, /VITE_API_URL is required/);
  });

  test('bakes the configured address in and never the localhost fallback', () => {
    const result = build({ VITE_API_URL: 'https://api.salon.example/api' });
    try {
      assert.equal(result.status, 0, result.stderr);
      const assets = path.join(result.outDir, 'assets');
      const bundle = readdirSync(assets).filter((file) => file.endsWith('.js')).map((file) => readFileSync(path.join(assets, file), 'utf8')).join('\n');
      assert.ok(bundle.includes('https://api.salon.example/api'));
      assert.ok(!bundle.includes('localhost:3000'), 'the development fallback must not ship');
    } finally {
      rmSync(result.outDir, { recursive: true, force: true });
    }
  });
});
