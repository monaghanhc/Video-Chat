import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../config.js';
import { createHttpApp } from '../app.js';
import { createDatabase } from '../db.js';
import { createAuthRepository } from './repository.js';
import { createRoomStore } from '../roomStore.js';

const config = loadConfig({
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  DATABASE_PATH: ':memory:'
});

const db = createDatabase(config);
const authRepo = createAuthRepository(db);
const roomStore = createRoomStore({ createWindowMs: 60_000, createMax: 20 });
const app = createHttpApp(config, authRepo, roomStore);

describe('auth routes', () => {
  it('returns 404 for unknown routes', async () => {
    await request(app).get('/unknown-route').expect(404);
  });

  it('returns health without room counts in production mode', async () => {
    const prodConfig = loadConfig({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
      DATABASE_PATH: ':memory:'
    });
    const prodApp = createHttpApp(prodConfig, createAuthRepository(createDatabase(prodConfig)), roomStore);
    const response = await request(prodApp).get('/health').expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.rooms).toBeUndefined();
  });

  it('issues guest tokens', async () => {
    const response = await request(app).post('/auth/guest').expect(200);
    expect(response.body.accessToken).toBeTypeOf('string');
    expect(response.body.expiresIn).toBeGreaterThan(0);
  });

  it('rejects invalid signup payloads', async () => {
    await request(app)
      .post('/auth/signup')
      .send({ email: 'bad', password: 'short', displayName: 'x' })
      .expect(400);
  });

  it('rejects XSS in signup display names', async () => {
    const response = await request(app)
      .post('/auth/signup')
      .send({
        email: 'safe@example.com',
        password: 'secure-password-1',
        displayName: '<script>alert(1)</script>Ada'
      })
      .expect(200);

    expect(response.body.user.displayName).not.toContain('<');
  });

  it('logs in existing users and returns /auth/me', async () => {
    await request(app)
      .post('/auth/signup')
      .send({
        email: 'login@example.com',
        password: 'secure-password-1',
        displayName: 'Login User'
      })
      .expect(200);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'secure-password-1' })
      .expect(200);

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(me.body.user.email).toBe('login@example.com');
    expect(me.body.user).not.toHaveProperty('password_hash');
  });

  it('rejects unauthorized /auth/me requests', async () => {
    await request(app).get('/auth/me').expect(401);
    await request(app).get('/auth/me').set('Authorization', 'Bearer invalid-token').expect(401);
  });

  it('rejects invalid login attempts', async () => {
    await request(app)
      .post('/auth/login')
      .send({ email: 'missing@example.com', password: 'secure-password-1' })
      .expect(401);
  });

  it('rotates refresh cookies', async () => {
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: 'refresh@example.com',
        password: 'secure-password-1',
        displayName: 'Refresh User'
      })
      .expect(200);

    const cookie = signup.headers['set-cookie'] as string[] | undefined;
    expect(cookie).toBeDefined();
    const refreshed = await request(app).post('/auth/refresh').set('Cookie', cookie!).expect(200);
    expect(refreshed.body.accessToken).toBeTypeOf('string');
  });

  it('logs out and clears sessions', async () => {
    const signup = await request(app)
      .post('/auth/signup')
      .send({
        email: 'logout@example.com',
        password: 'secure-password-1',
        displayName: 'Logout User'
      })
      .expect(200);

    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .set('Cookie', signup.headers['set-cookie']!)
      .expect(204);
  });
});
