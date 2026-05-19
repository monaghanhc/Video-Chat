import type { AuthTokenResponse, AuthUserPublic } from '@deskcall/shared';

const ACCESS_TOKEN_KEY = 'deskcall:accessToken';
const ACCESS_EXPIRY_KEY = 'deskcall:accessExpiry';
const USER_KEY = 'deskcall:user';

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  user: AuthUserPublic | null;
}

function readSession(): StoredSession | null {
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  const expiresAt = Number(window.localStorage.getItem(ACCESS_EXPIRY_KEY) ?? 0);
  const userRaw = window.localStorage.getItem(USER_KEY);

  if (!accessToken || !expiresAt) {
    return null;
  }

  let user: AuthUserPublic | null = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as AuthUserPublic;
    } catch {
      user = null;
    }
  }

  return { accessToken, expiresAt, user };
}

function writeSession(response: AuthTokenResponse): void {
  const expiresAt = Date.now() + response.expiresIn * 1000 - 5_000;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, response.accessToken);
  window.localStorage.setItem(ACCESS_EXPIRY_KEY, String(expiresAt));
  if (response.user) {
    window.localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  } else {
    window.localStorage.removeItem(USER_KEY);
  }
}

function clearSession(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(ACCESS_EXPIRY_KEY);
  window.localStorage.removeItem(USER_KEY);
}

async function postJson<T>(baseUrl: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `Request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

export async function ensureAccessToken(signalingServerUrl: string): Promise<string> {
  const baseUrl = signalingServerUrl.replace(/\/$/, '');
  const existing = readSession();
  if (existing && existing.expiresAt > Date.now()) {
    return existing.accessToken;
  }

  if (existing?.user) {
    try {
      const refreshed = await postJson<AuthTokenResponse>(baseUrl, '/auth/refresh');
      writeSession(refreshed);
      return refreshed.accessToken;
    } catch {
      clearSession();
    }
  }

  const guest = await postJson<AuthTokenResponse>(baseUrl, '/auth/guest');
  writeSession(guest);
  return guest.accessToken;
}

export async function signup(
  signalingServerUrl: string,
  payload: { email: string; password: string; displayName: string }
): Promise<AuthUserPublic> {
  const response = await postJson<AuthTokenResponse>(
    signalingServerUrl.replace(/\/$/, ''),
    '/auth/signup',
    payload
  );
  writeSession(response);
  return response.user!;
}

export async function login(
  signalingServerUrl: string,
  payload: { email: string; password: string }
): Promise<AuthUserPublic> {
  const response = await postJson<AuthTokenResponse>(
    signalingServerUrl.replace(/\/$/, ''),
    '/auth/login',
    payload
  );
  writeSession(response);
  return response.user!;
}

export async function logout(signalingServerUrl: string): Promise<void> {
  const baseUrl = signalingServerUrl.replace(/\/$/, '');
  const session = readSession();
  await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: session
      ? { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' }
      : { Accept: 'application/json' },
    credentials: 'include'
  }).catch(() => undefined);
  clearSession();
}

export function getStoredUser(): AuthUserPublic | null {
  return readSession()?.user ?? null;
}
