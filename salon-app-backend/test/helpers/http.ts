import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app';

type RequestOptions = { token?: string; body?: unknown; headers?: Record<string, string> };
export type TestResponse = { status: number; headers: Headers; body: any };

export const startTestServer = async (options?: Parameters<typeof createApp>[0]) => {
  const app = createApp(options);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

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

  const close = () => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

  return { baseUrl, request, close };
};

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;
