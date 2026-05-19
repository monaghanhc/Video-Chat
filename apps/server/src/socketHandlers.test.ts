import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@deskcall/shared';
import { loadConfig } from './config.js';
import { createDeskCallServer } from './createServer.js';
import { signAccessToken } from './auth/tokens.js';

const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '4010',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  DATABASE_PATH: ':memory:'
});

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe('socketHandlers integration', () => {
  const { httpServer } = createDeskCallServer(config);
  let baseUrl = '';
  let hostToken = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    hostToken = signAccessToken(config, { sub: 'guest:host', type: 'guest' });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  function connectClient(token: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const client = createClient(baseUrl, {
        transports: ['websocket'],
        auth: { token }
      });

      client.on('connect', () => resolve(client));
      client.on('connect_error', (error) => reject(error));
    });
  }

  it('rejects sockets without a valid token', async () => {
    await expect(connectClient('not-a-valid-token')).rejects.toThrow();
  });

  it('ignores malformed signal payloads', async () => {
    const client = await connectClient(hostToken);
    const created = await new Promise<string>((resolve) => {
      client.once('room:created', (payload) => resolve(payload.roomId));
      client.emit('room:create');
    });

    client.emit('signal:offer', {
      roomId: created,
      targetId: 'missing-peer',
      description: { type: 'offer', sdp: 'x'.repeat(100_000) }
    } as never);

    client.disconnect();
    expect(created).toHaveLength(6);
  });

  it('prevents joining a room without a valid code', async () => {
    const client = await connectClient(hostToken);
    const errorMessage = await new Promise<string>((resolve) => {
      client.once('room:error', (payload) => resolve(payload.message));
      client.emit('room:join', { roomId: 'BAD!!!' } as never);
    });

    expect(errorMessage).toMatch(/invalid/i);
    client.disconnect();
  });
});
