# DeskCall security hardening

This document describes the security controls added to DeskCall and how to configure them.

## Summary

DeskCall remains a **room-code-based** video chat product. Security hardening adds:

- Optional **registered accounts** (Argon2id passwords, JWT access + rotating refresh cookies)
- **Guest tokens** so anonymous calls still work (`AUTH_MODE=optional`)
- **Socket authentication** before any signaling event is accepted
- **Input validation** (Zod) for rooms, chat, WebRTC signaling, block/report events
- **Rate limits** on HTTP auth routes, room create/join, and per-socket event throughput
- **SQLite** persistence for users and refresh sessions (parameterized queries only)
- **Chat sanitization** (HTML/control character stripping)
- **In-room block/report** with audit logging
- **Production-safe** health endpoint and HTTP error handling

## Environment variables

Copy `.env.example` to `.env` at the repo root (or `apps/server/.env`).

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_ACCESS_SECRET` | Yes | Random string, **≥ 32 characters**. Signs short-lived access tokens. |
| `JWT_REFRESH_SECRET` | Yes | Random string, **≥ 32 characters**. Signs refresh tokens. |
| `CORS_ORIGIN` | Yes | Allowed browser origin (e.g. `https://your-pages-url.github.io`). |
| `AUTH_MODE` | No | `optional` (default) or `required`. `required` rejects sockets without a valid token. |
| `DATABASE_PATH` | No | SQLite file path. Use `:memory:` for tests. |
| `COOKIE_SECURE` | No | Set `true` in production behind HTTPS. |
| `TRUST_PROXY` | No | Set `true` when behind Render/nginx so rate limits use client IP. |
| `ROOM_RATE_LIMIT_*` | No | HTTP + room-create window/limit. |
| `ROOM_JOIN_RATE_LIMIT_MAX` | No | Max join attempts per socket per window. |
| `SOCKET_EVENT_RATE_LIMIT_MAX` | No | Max socket events per socket/event name per window. |
| `AUTH_RATE_LIMIT_MAX` | No | Max `/auth/*` requests per IP per window. |

Generate secrets (PowerShell example):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Authentication flow

### Guest (default)

1. Client `POST /auth/guest` → receives access token (~15 min).
2. Socket.IO connects with `auth: { token }`.
3. Room create/join works as before.

### Registered user

1. `POST /auth/signup` or `POST /auth/login` with JSON body.
2. Server returns access token JSON and sets **httpOnly** `deskcall_refresh` cookie on `/auth`.
3. `POST /auth/refresh` rotates refresh token and issues new access token.
4. `POST /auth/logout` revokes refresh sessions and clears cookie.
5. `GET /auth/me` returns public user profile (no password hash).

Passwords are hashed with **Argon2id**. Minimum length: 12 characters.

## Authorization model

| Resource | Control |
|----------|---------|
| Rooms | 6-character code + membership check on every signal/chat event |
| Signaling | Sender must be in room; target must be in room; blocked pairs cannot signal |
| Chat | Sanitized body; not delivered to users who blocked the sender |
| User data | `/auth/me` only returns own profile; DB never sent to clients |

There are no admin routes yet; `role` is stored for future moderation tools.

## WebSocket / WebRTC

- **Handshake auth** validates JWT before `connection`.
- **Zod schemas** validate `room:*`, `signal:*`, `chat:message`, `room:block`, `room:report`.
- **SDP/candidate size caps** reduce DoS via oversized payloads.
- **Per-event throttling** drops excessive socket traffic (audit log: `socket.rate_limited`).
- **ICE/signaling** still relays only between verified room members; `fromId` is set server-side.

## API / HTTP

- `helmet` with CSP in production
- `express-rate-limit` on all HTTP routes; stricter limiter on `/auth`
- `express.json` limited to 16kb
- Generic `500` responses (no stack traces to clients)
- `/health` in production returns only `{ ok, timestamp }` (no room counts)

## Chat & abuse

- Message bodies sanitized server-side
- Max length 1000 characters
- `room:block` / `room:unblock` per participant
- `room:report` writes structured audit logs (no PII beyond socket/user ids)

## Database

- SQLite via `better-sqlite3`
- All queries use **prepared statements**
- Indexes on `users.email`, `refresh_tokens.token_hash`
- Password hashes and refresh token hashes never exposed in API responses

## Client changes

- `authSession.ts` obtains guest or user tokens before Socket.IO connects
- Optional **AuthPanel** on the welcome screen (signup/login/logout)
- Tokens stored in `localStorage` (access only); refresh token stays httpOnly cookie

## Deployment checklist

1. Set strong `JWT_*_SECRET` values in Render/GitHub secrets (required for server startup).
2. Set `CORS_ORIGIN` to your static app origin only, e.g. `https://monaghanhc.github.io`.
3. Use `render.yaml` defaults: `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `DATABASE_PATH=./data/deskcall.db`.
4. On Render **free** tier, the SQLite file is ephemeral (accounts reset on redeploy); guest calls always work.
5. Review audit logs for `auth.login.failure`, `room.join.failure`, `socket.rate_limited`.

## Threat notes (remaining)

- Room codes are still shared secrets; rate limits reduce guessing but do not eliminate it.
- TURN credentials in `VITE_*` are visible in client bundles (normal for WebRTC).
- Guest tokens are bearer credentials; treat signaling URL as a trust boundary.
- Set `AUTH_MODE=required` only when you are ready to require accounts or guest issuance via your UI.

## Tests

Security-focused tests cover:

| Area | Test files |
|------|------------|
| Config / env validation | `apps/server/src/config.test.ts` |
| Password hashing (Argon2id) | `apps/server/src/auth/passwords.test.ts` |
| JWT access + refresh | `apps/server/src/auth/tokens.test.ts` |
| User DB / no hash leakage | `apps/server/src/auth/repository.test.ts` |
| Auth HTTP routes + XSS signup | `apps/server/src/auth/routes.test.ts` |
| Unauthorized `/auth/me` | `apps/server/src/auth/routes.test.ts` |
| Socket auth (missing/invalid token) | `apps/server/src/socketAuth.test.ts` |
| Socket integration (bad join, oversized SDP) | `apps/server/src/socketHandlers.test.ts` |
| Room join/create rate limits & blocks | `apps/server/src/roomStore.test.ts` |
| Per-socket event throttling | `apps/server/src/security/socketThrottle.test.ts` |
| Chat XSS sanitization | `packages/shared/src/index.test.ts`, `security.test.ts` |
| Signal payload validation | `packages/shared/src/signals.test.ts` |
| Client token/session handling | `apps/desktop/src/lib/authSession.test.ts` |

Run:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
```

## Code changes (reference)

| Component | Files added or updated |
|-----------|------------------------|
| Shared schemas / sanitization | `packages/shared/src/security.ts`, `auth.ts`, `signals.ts`, `rooms.ts`, `index.ts` |
| Server config | `apps/server/src/config.ts` |
| SQLite + migrations | `apps/server/src/db.ts` |
| Auth (hash, JWT, routes, repo) | `apps/server/src/auth/*` |
| HTTP app factory | `apps/server/src/app.ts`, `createServer.ts` |
| Socket auth + handlers | `apps/server/src/socketAuth.ts`, `socketHandlers.ts` |
| Room store hardening | `apps/server/src/roomStore.ts` |
| Audit + throttle | `apps/server/src/security/*` |
| Client auth + UI | `apps/desktop/src/lib/authSession.ts`, `components/AuthPanel.tsx`, `hooks/useDeskCall.ts` |
| Env template | `.env.example` |
| Deploy | `render.yaml` |
