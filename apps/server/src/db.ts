import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServerConfig } from './config.js';

export type UserRole = 'user' | 'admin';

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export interface DbUserPublic {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export function createDatabase(config: ServerConfig): Database.Database {
  if (config.DATABASE_PATH !== ':memory:') {
    mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
  }

  const db = new Database(config.DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
  `);
}

export function toPublicUser(user: DbUser): DbUserPublic {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    created_at: user.created_at
  };
}
