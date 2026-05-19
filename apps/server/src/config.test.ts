import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('loads valid environment', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
      CORS_ORIGIN: 'http://localhost:5173'
    });

    expect(config.PORT).toBe(4000);
    expect(config.AUTH_MODE).toBe('optional');
  });

  it('throws when jwt secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/Invalid server environment/);
  });
});
