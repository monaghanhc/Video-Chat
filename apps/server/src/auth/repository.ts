import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { sanitizeText, type AuthUserPublic } from '@deskcall/shared';
import type { DbUser, DbUserPublic } from '../db.js';
import { toPublicUser } from '../db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { hashRefreshToken } from './tokens.js';

export function createAuthRepository(db: Database.Database) {
  const findByEmailStmt = db.prepare<[string], DbUser | undefined>(
    'SELECT * FROM users WHERE email = ? COLLATE NOCASE'
  );
  const findByIdStmt = db.prepare<[string], DbUser | undefined>('SELECT * FROM users WHERE id = ?');
  const insertUserStmt = db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)'
  );
  const insertRefreshStmt = db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  );
  const findRefreshStmt = db.prepare<[string], { id: string; user_id: string; revoked_at: string | null } | undefined>(
    'SELECT id, user_id, revoked_at FROM refresh_tokens WHERE token_hash = ?'
  );
  const revokeRefreshStmt = db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ?');
  const revokeAllForUserStmt = db.prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_id = ? AND revoked_at IS NULL');

  function toAuthUserPublic(user: DbUserPublic): AuthUserPublic {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at
    };
  }

  async function createUser(email: string, password: string, displayName: string): Promise<AuthUserPublic> {
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const safeName = sanitizeText(displayName, 32);

    insertUserStmt.run(id, email, passwordHash, safeName, 'user');
    const created = findByIdStmt.get(id);
    if (!created) {
      throw new Error('Failed to create user.');
    }

    return toAuthUserPublic(toPublicUser(created));
  }

  async function authenticate(email: string, password: string): Promise<AuthUserPublic | null> {
    const user = findByEmailStmt.get(email);
    if (!user) {
      return null;
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      return null;
    }

    return toAuthUserPublic(toPublicUser(user));
  }

  function getUserById(userId: string): AuthUserPublic | null {
    const user = findByIdStmt.get(userId);
    return user ? toAuthUserPublic(toPublicUser(user)) : null;
  }

  function storeRefreshToken(userId: string, tokenId: string, refreshToken: string, expiresAt: Date): void {
    insertRefreshStmt.run(tokenId, userId, hashRefreshToken(refreshToken), expiresAt.toISOString());
  }

  function validateRefreshToken(refreshToken: string): { userId: string; tokenId: string } | null {
    const row = findRefreshStmt.get(hashRefreshToken(refreshToken));
    if (!row || row.revoked_at) {
      return null;
    }

    return { userId: row.user_id, tokenId: row.id };
  }

  function revokeRefreshToken(tokenId: string): void {
    revokeRefreshStmt.run(tokenId);
  }

  function revokeAllSessions(userId: string): void {
    revokeAllForUserStmt.run(userId);
  }

  return {
    createUser,
    authenticate,
    getUserById,
    storeRefreshToken,
    validateRefreshToken,
    revokeRefreshToken,
    revokeAllSessions,
    emailExists(email: string): boolean {
      return Boolean(findByEmailStmt.get(email));
    }
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
