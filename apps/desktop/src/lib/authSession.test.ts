import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAccessToken, getStoredUser, login, logout } from './authSession';

describe('authSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('requests a guest token when none is stored', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'guest-token', expiresIn: 900 })
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await ensureAccessToken('http://localhost:4000');
    expect(token).toBe('guest-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/auth/guest',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reuses a valid stored access token', async () => {
    window.localStorage.setItem('deskcall:accessToken', 'cached-token');
    window.localStorage.setItem('deskcall:accessExpiry', String(Date.now() + 60_000));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const token = await ensureAccessToken('http://localhost:4000');
    expect(token).toBe('cached-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores user sessions from login responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: 'user-token',
        expiresIn: 900,
        user: {
          id: '1',
          email: 'a@b.com',
          displayName: 'Ada',
          role: 'user',
          createdAt: 'now'
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = await login('http://localhost:4000', {
      email: 'a@b.com',
      password: 'secure-password-1'
    });

    expect(user.displayName).toBe('Ada');
    expect(getStoredUser()?.email).toBe('a@b.com');
  });

  it('falls back to guest tokens when refresh fails', async () => {
    window.localStorage.setItem('deskcall:accessToken', 'expired');
    window.localStorage.setItem('deskcall:accessExpiry', String(Date.now() - 1));
    window.localStorage.setItem(
      'deskcall:user',
      JSON.stringify({
        id: '1',
        email: 'a@b.com',
        displayName: 'Ada',
        role: 'user',
        createdAt: 'now'
      })
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'fresh-guest', expiresIn: 900 })
      });
    vi.stubGlobal('fetch', fetchMock);

    const token = await ensureAccessToken('http://localhost:4000');
    expect(token).toBe('fresh-guest');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears sessions on logout', async () => {
    window.localStorage.setItem('deskcall:accessToken', 'token');
    window.localStorage.setItem('deskcall:accessExpiry', String(Date.now() + 60_000));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await logout('http://localhost:4000');
    expect(getStoredUser()).toBeNull();
  });

  it('returns stored user after signup response', async () => {
    window.localStorage.setItem('deskcall:accessToken', 'token');
    window.localStorage.setItem('deskcall:accessExpiry', String(Date.now() + 60_000));
    window.localStorage.setItem(
      'deskcall:user',
      JSON.stringify({
        id: '1',
        email: 'a@b.com',
        displayName: 'Ada',
        role: 'user',
        createdAt: 'now'
      })
    );

    expect(getStoredUser()?.displayName).toBe('Ada');
  });
});
