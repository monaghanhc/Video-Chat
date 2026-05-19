import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';
import { createAuthRepository } from './repository.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters'
});

describe('auth repository', () => {
  it('creates users without exposing password hashes', async () => {
    const db = createDatabase(config);
    const repo = createAuthRepository(db);
    const user = await repo.createUser('person@example.com', 'secure-password-1', 'Person');

    expect(user.email).toBe('person@example.com');
    expect(user).not.toHaveProperty('password_hash');

    const authenticated = await repo.authenticate('person@example.com', 'secure-password-1');
    expect(authenticated?.id).toBe(user.id);
    expect(await repo.authenticate('person@example.com', 'wrong')).toBeNull();
  });
});
