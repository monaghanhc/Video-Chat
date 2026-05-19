# DeskCall

DeskCall is a Windows-first desktop video chat app built with Electron, React, TypeScript, Vite,
Express, Socket.IO, and WebRTC. The MVP is intentionally free to run: the media path is peer-to-peer,
the signaling server is lightweight, and no paid service is required until you need stronger NAT
traversal in production.

[![Download DeskCall for Windows](https://img.shields.io/badge/Download-Windows%20installer-2563eb?style=for-the-badge&logo=windows)](https://github.com/monaghanhc/Video-Chat/releases/latest/download/DeskCall-Setup.exe)
[![Open DeskCall web app](https://img.shields.io/badge/Open-Web%20app-111827?style=for-the-badge&logo=googlechrome)](https://monaghanhc.github.io/Video-Chat/)
[![Deploy signaling server to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/monaghanhc/Video-Chat)

Live beta endpoints:

- Web app: `https://monaghanhc.github.io/Video-Chat/`
- Signaling server: `https://deskcall-signaling.onrender.com`

## Monorepo layout

```text
apps/
  desktop/   Electron + React client
  server/    Express + Socket.IO signaling service
packages/
  shared/    Shared TypeScript contracts
```

## Quick start

```bash
npm install
npm run dev
```

That starts:

- the signaling server on `http://localhost:4000`
- the Vite renderer on `http://localhost:5173`
- the Electron desktop app window

Useful commands:

```bash
npm run dev:server
npm run dev:desktop
npm run dev:web
npm run build
npm run build:web
npm run lint
npm run typecheck
npm run package:windows
```

## Configure the signaling server

Copy `.env.example` to `.env` and adjust as needed:

```bash
PORT=4000
CORS_ORIGIN=http://localhost:5173
VITE_SIGNALING_SERVER_URL=http://localhost:4000
DESKCALL_SIGNALING_SERVER_URL=http://localhost:4000
```

The shipped app defaults to the public signaling backend at `https://deskcall-signaling.onrender.com`,
then lets each user override and persist that value inside the Settings panel.

## Installable web app

DeskCall also ships as a downloadable web app (PWA). Run the web client locally with:

```bash
npm run dev:web
```

Build the static site bundle with:

```bash
npm run build:web
npm run preview:web
```

Every push to `main` deploys the web app to:

```text
https://monaghanhc.github.io/Video-Chat/
```

The web build includes:

- `manifest.webmanifest`
- install icons
- a service worker app shell
- an in-app `Install app` affordance where the browser exposes install prompts

For real deployments, set the GitHub Actions repository variable `VITE_SIGNALING_SERVER_URL` to the
public signaling server URL so visitors land on a usable server immediately. A `render.yaml` Blueprint
is included for the signaling server, and the button above opens the free Render deployment flow.

## Test a call between two computers

1. Deploy or expose the signaling server so both machines can reach the same URL.
2. Set that URL in DeskCall Settings on both machines.
3. On machine A, create a room and copy the six-character invite code.
4. On machine B, join with that code.
5. Allow camera and microphone access on both machines.

For a same-network smoke test, you can also run the server on one machine and use that machine's LAN
IP from the other client, for example `http://192.168.1.20:4000`.

## Windows installer

Build the app and package an NSIS installer:

```bash
npm run package:windows
```

Artifacts are written to `apps/desktop/release/` with names like:

```text
DeskCall-Setup.exe
```

The repository includes placeholder icon assets in `apps/desktop/build/` plus installer metadata and
versioning in `apps/desktop/package.json`.

## Production deployment (free tier)

DeskCall is designed to run at **zero monthly cost** for the default stack:

| Piece | Free service | URL |
|-------|----------------|-----|
| Web app | GitHub Pages | `https://monaghanhc.github.io/Video-Chat/` |
| Signaling | Render free web service | `https://deskcall-signaling.onrender.com` |
| Media | WebRTC peer-to-peer | No relay cost (STUN is public) |
| TURN | Optional | Bring your own only if NATs are difficult |

Pushes to `main` run CI (lint, tests, build), deploy the web app to GitHub Pages, and redeploy
signaling on Render when connected via `render.yaml`.

### One-time Render setup (after deploy)

In the Render dashboard for `deskcall-signaling`, set:

1. **`CORS_ORIGIN`** = `https://monaghanhc.github.io` (no trailing slash)
2. **`JWT_ACCESS_SECRET`** = random string, at least 32 characters
3. **`JWT_REFRESH_SECRET`** = different random string, at least 32 characters

Generate secrets (PowerShell):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Without the JWT secrets the server will not start. Guest video calls work without user signups;
optional accounts use the SQLite file at `./data/deskcall.db` (ephemeral on Render free—resets on
redeploy, which is fine for the beta).

See `SECURITY_HARDENING.md` for the full security and environment reference.

### Local production build smoke test

```bash
npm ci
npm run lint
npm run test
npm run build
```

### TURN support

The beta ships with a public STUN server only. That is enough for many networks, but not all of them.
For stronger production reliability, add your own TURN service and set:

```bash
VITE_TURN_URLS=turn:turn.example.com:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-secret
```

TURN is optional for the MVP, but it is the difference between "usually works" and "works across hostile
NATs."

## Beta feature set

- mesh WebRTC video calls (up to four participants)
- local preview and remote participant video
- mute, camera toggle, end-call controls
- room creation and join by short invite code
- participant presence
- signaling auto-reconnect
- adaptive video bitrate/resolution ladder
- device selection for camera, microphone, and supported speakers
- screen sharing
- in-call peer-to-peer chat via WebRTC data channels
- incoming call tones
- clearer connection and failure states
- floating self-preview on smaller screens
- persisted local settings

## Known limitations

- rooms support up to four participants in a mesh call
- TURN credentials are not bundled; add your own before serious production rollout
- optional accounts and guest tokens are supported; see `SECURITY_HARDENING.md` for production auth configuration
- screen sharing currently uses Electron's capture flow without a custom branded source picker
- macOS packaging is scaffolded but not yet notarized or tested

## Future macOS packaging

The `electron-builder` config already includes a future `.dmg` target. Before shipping on macOS, add:

- Apple signing credentials
- hardened runtime settings
- notarization
- final `.icns` artwork
