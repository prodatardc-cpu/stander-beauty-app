import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app';
import { attachRealtime } from '../../src/services/realtime';

type RequestOptions = { token?: string; body?: unknown; headers?: Record<string, string> };
export type TestResponse = { status: number; headers: Headers; body: any };

// `realtime`: also serves the Socket.IO events on the same server, as src/server.ts does.
export const startTestServer = async (options?: Parameters<typeof createApp>[0], { realtime = false } = {}) => {
  const app = createApp(options);
  const server = http.createServer(app);
  const events = realtime ? attachRealtime(server) : null;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const baseUrl = `${origin}/api`;

  const request = async (method: string, path: string, { token, body, headers }: RequestOptions = {}): Promise<TestResponse> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body: keep the raw text.
    }
    return { status: response.status, headers: response.headers, body: parsed };
  };

  const close = async () => {
    server.closeAllConnections();
    // Closing Socket.IO also closes the HTTP server.
    if (events) return events.close();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { origin, baseUrl, request, close };
};

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;
