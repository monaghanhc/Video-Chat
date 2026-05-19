import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createSocketAuthMiddleware } from './socketAuth.js';
import { signAccessToken } from './auth/tokens.js';

const config = loadConfig({
  NODE_ENV: 'test',
  AUTH_MODE: 'required',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters'
});

describe('createSocketAuthMiddleware', () => {
  it('rejects connections without a token when auth is required', () => {
    const middleware = createSocketAuthMiddleware(config);
    const next = vi.fn();

    middleware(
      {
        id: 'socket-1',
        handshake: { auth: {}, headers: {} }
      } as never,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('requires guest issuance when auth is optional and token missing', () => {
    const optional = createSocketAuthMiddleware({
      ...config,
      AUTH_MODE: 'optional'
    });
    const next = vi.fn();

    optional(
      {
        id: 'socket-1',
        handshake: { auth: {}, headers: {} }
      } as never,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('guest') }));
  });

  it('accepts authorization headers', () => {
    const middleware = createSocketAuthMiddleware(config);
    const token = signAccessToken(config, { sub: 'guest:header', type: 'guest' });
    const socket = {
      id: 'socket-1',
      handshake: { auth: {}, headers: { authorization: `Bearer ${token}` } },
      data: {} as Record<string, unknown>
    };
    const next = vi.fn();

    middleware(socket as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.subjectId).toBe('guest:header');
  });

  it('accepts valid bearer tokens', () => {
    const middleware = createSocketAuthMiddleware(config);
    const token = signAccessToken(config, { sub: 'guest:abc', type: 'guest' });
    const socket = {
      id: 'socket-1',
      handshake: { auth: { token }, headers: {} },
      data: {} as Record<string, unknown>
    };
    const next = vi.fn();

    middleware(socket as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.subjectId).toBe('guest:abc');
  });
});
