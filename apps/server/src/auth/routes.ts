import { randomUUID } from 'node:crypto';
import type { Express, Response } from 'express';
import {
  loginBodySchema,
  sanitizeText,
  signupBodySchema,
  type AuthTokenResponse
} from '@deskcall/shared';
import type { ServerConfig } from '../config.js';
import { auditLog } from '../security/auditLog.js';
import type { AuthRepository } from './repository.js';
import {
  createRefreshTokenId,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
} from './tokens.js';

const REFRESH_COOKIE = 'deskcall_refresh';

export function registerAuthRoutes(
  app: Express,
  config: ServerConfig,
  authRepo: AuthRepository
): void {
  function setRefreshCookie(response: Response, token: string): void {
    const secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure,
      // Cross-origin web app (GitHub Pages) + signaling (Render) needs SameSite=None when secure.
      sameSite: secure ? 'none' : 'lax',
      path: '/auth',
      maxAge: config.JWT_REFRESH_TTL_SECONDS * 1000
    });
  }

  function clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  function accessResponse(
    response: Response,
    claims: Parameters<typeof signAccessToken>[1],
    user?: AuthTokenResponse['user']
  ): void {
    response.json({
      accessToken: signAccessToken(config, claims),
      expiresIn: config.JWT_ACCESS_TTL_SECONDS,
      user
    } satisfies AuthTokenResponse);
  }

  app.post('/auth/signup', async (request, response) => {
    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      auditLog('auth.signup.failure', { reason: 'validation' });
      response.status(400).json({ error: 'Invalid signup payload.' });
      return;
    }

    const { email, password, displayName } = parsed.data;
    if (authRepo.emailExists(email)) {
      auditLog('auth.signup.failure', { reason: 'email_taken' });
      response.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }

    try {
      const user = await authRepo.createUser(email, password, displayName);
      const refreshId = createRefreshTokenId();
      const refreshToken = signRefreshToken(config, user.id, refreshId);
      const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000);
      authRepo.storeRefreshToken(user.id, refreshId, refreshToken, expiresAt);
      setRefreshCookie(response, refreshToken);
      auditLog('auth.signup.success', { userId: user.id });
      accessResponse(
        response,
        { sub: user.id, type: 'user', role: user.role, displayName: user.displayName },
        user
      );
    } catch {
      auditLog('auth.signup.failure', { reason: 'server' });
      response.status(500).json({ error: 'Unable to create account.' });
    }
  });

  app.post('/auth/login', async (request, response) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      auditLog('auth.login.failure', { reason: 'validation' });
      response.status(400).json({ error: 'Invalid login payload.' });
      return;
    }

    const user = await authRepo.authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      auditLog('auth.login.failure', { reason: 'invalid_credentials' });
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const refreshId = createRefreshTokenId();
    const refreshToken = signRefreshToken(config, user.id, refreshId);
    const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000);
    authRepo.storeRefreshToken(user.id, refreshId, refreshToken, expiresAt);
    setRefreshCookie(response, refreshToken);
    auditLog('auth.login.success', { userId: user.id });
    accessResponse(
      response,
      { sub: user.id, type: 'user', role: user.role, displayName: user.displayName },
      user
    );
  });

  app.post('/auth/guest', (_request, response) => {
    const guestId = `guest:${randomUUID()}`;
    auditLog('auth.guest.created', { guestId });
    accessResponse(response, {
      sub: guestId,
      type: 'guest',
      displayName: sanitizeText('Guest', 32)
    });
  });

  app.post('/auth/refresh', (request, response) => {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string') {
      auditLog('auth.refresh.failure', { reason: 'missing_cookie' });
      response.status(401).json({ error: 'Missing refresh token.' });
      return;
    }

    const verified = verifyRefreshToken(config, token);
    if (!verified) {
      auditLog('auth.refresh.failure', { reason: 'invalid_jwt' });
      clearRefreshCookie(response);
      response.status(401).json({ error: 'Invalid refresh token.' });
      return;
    }

    const stored = authRepo.validateRefreshToken(token);
    if (!stored || stored.tokenId !== verified.tokenId || stored.userId !== verified.userId) {
      auditLog('auth.refresh.failure', { reason: 'revoked_or_unknown' });
      clearRefreshCookie(response);
      response.status(401).json({ error: 'Refresh token revoked.' });
      return;
    }

    const user = authRepo.getUserById(verified.userId);
    if (!user) {
      clearRefreshCookie(response);
      response.status(401).json({ error: 'User not found.' });
      return;
    }

    authRepo.revokeRefreshToken(verified.tokenId);
    const refreshId = createRefreshTokenId();
    const nextRefresh = signRefreshToken(config, user.id, refreshId);
    const expiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_SECONDS * 1000);
    authRepo.storeRefreshToken(user.id, refreshId, nextRefresh, expiresAt);
    setRefreshCookie(response, nextRefresh);
    accessResponse(
      response,
      { sub: user.id, type: 'user', role: user.role, displayName: user.displayName },
      user
    );
  });

  app.post('/auth/logout', (request, response) => {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string') {
      const verified = verifyRefreshToken(config, token);
      if (verified) {
        authRepo.revokeRefreshToken(verified.tokenId);
      }
    }

    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const access = verifyAccessToken(config, header.slice(7));
      if (access?.type === 'user') {
        authRepo.revokeAllSessions(access.sub);
      }
    }

    clearRefreshCookie(response);
    auditLog('auth.logout');
    response.status(204).end();
  });

  app.get('/auth/me', (request, response) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const access = verifyAccessToken(config, header.slice(7));
    if (!access || access.type !== 'user') {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const user = authRepo.getUserById(access.sub);
    if (!user) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    response.json({ user });
  });
}

export { REFRESH_COOKIE };
