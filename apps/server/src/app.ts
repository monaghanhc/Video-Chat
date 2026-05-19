import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Server as HttpServer } from 'node:http';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@deskcall/shared';
import { registerAuthRoutes } from './auth/routes.js';
import type { AuthRepository } from './auth/repository.js';
import type { ServerConfig } from './config.js';
import type { RoomStore } from './roomStore.js';

export function createHttpApp(
  config: ServerConfig,
  authRepo: AuthRepository,
  roomStore: RoomStore
): express.Express {
  const app = express();

  if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: config.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));

  const authLimiter = rateLimit({
    windowMs: config.ROOM_RATE_LIMIT_WINDOW_MS,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many auth requests. Try again later.' }
  });

  const httpLimiter = rateLimit({
    windowMs: config.ROOM_RATE_LIMIT_WINDOW_MS,
    limit: config.ROOM_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' }
  });

  app.use('/auth', authLimiter);
  app.use(httpLimiter);
  registerAuthRoutes(app, config, authRepo);

  app.get('/health', (_request, response) => {
    if (config.NODE_ENV === 'production') {
      response.json({ ok: true, timestamp: new Date().toISOString() });
      return;
    }

    response.json({
      ok: true,
      rooms: roomStore.getSnapshot().roomCount,
      timestamp: new Date().toISOString()
    });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found.' });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response) => {
    console.error('[http] unhandled error', error instanceof Error ? error.message : 'unknown');
    response.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

export type DeskCallIo = Server<ClientToServerEvents, ServerToClientEvents>;

export interface DeskCallServer {
  app: express.Express;
  httpServer: HttpServer;
  io: DeskCallIo;
}
