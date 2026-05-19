import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });
});
