import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from './tokens.js';

const config = loadConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters'
});

describe('tokens', () => {
  it('signs and verifies access tokens', () => {
    const token = signAccessToken(config, { sub: 'user-1', type: 'user', role: 'user' });
    const verified = verifyAccessToken(config, token);
    expect(verified?.sub).toBe('user-1');
  });

  it('rejects tampered tokens', () => {
    const token = signAccessToken(config, { sub: 'guest:1', type: 'guest' });
    expect(verifyAccessToken(config, `${token}invalid`)).toBeNull();
  });

  it('signs and verifies refresh tokens', () => {
    const refresh = signRefreshToken(config, 'user-1', 'token-id');
    expect(verifyRefreshToken(config, refresh)).toEqual({ userId: 'user-1', tokenId: 'token-id' });
  });
});
