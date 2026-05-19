import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { ServerConfig } from '../config.js';

export interface AccessTokenClaims {
  sub: string;
  type: 'user' | 'guest';
  role?: 'user' | 'admin';
  displayName?: string;
}

export interface VerifiedToken extends AccessTokenClaims {
  jti?: string;
}

export function signAccessToken(config: ServerConfig, claims: AccessTokenClaims): string {
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_TTL_SECONDS,
    issuer: 'deskcall',
    audience: 'deskcall-client'
  });
}

export function verifyAccessToken(config: ServerConfig, token: string): VerifiedToken | null {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: 'deskcall',
      audience: 'deskcall-client'
    });

    if (typeof payload === 'string' || !payload || typeof payload.sub !== 'string') {
      return null;
    }

    if (payload.type !== 'user' && payload.type !== 'guest') {
      return null;
    }

    return {
      sub: payload.sub,
      type: payload.type,
      role: payload.role === 'admin' ? 'admin' : payload.role === 'user' ? 'user' : undefined,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
      jti: typeof payload.jti === 'string' ? payload.jti : undefined
    };
  } catch {
    return null;
  }
}

export function createRefreshTokenId(): string {
  return randomUUID();
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signRefreshToken(config: ServerConfig, userId: string, tokenId: string): string {
  return jwt.sign(
    { sub: userId, jti: tokenId, type: 'refresh' },
    config.JWT_REFRESH_SECRET,
    {
      expiresIn: config.JWT_REFRESH_TTL_SECONDS,
      issuer: 'deskcall',
      audience: 'deskcall-refresh'
    }
  );
}

export function verifyRefreshToken(
  config: ServerConfig,
  token: string
): { userId: string; tokenId: string } | null {
  try {
    const payload = jwt.verify(token, config.JWT_REFRESH_SECRET, {
      issuer: 'deskcall',
      audience: 'deskcall-refresh'
    });

    if (
      typeof payload === 'string' ||
      !payload ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      payload.type !== 'refresh'
    ) {
      return null;
    }

    return { userId: payload.sub, tokenId: payload.jti };
  } catch {
    return null;
  }
}
