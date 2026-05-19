import { createServer as createHttpServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@deskcall/shared';
import { createHttpApp } from './app.js';
import { createAuthRepository } from './auth/repository.js';
import type { ServerConfig } from './config.js';
import { createDatabase } from './db.js';
import { createRoomStore } from './roomStore.js';
import { attachSocketHandlers } from './socketHandlers.js';
import { createSocketAuthMiddleware } from './socketAuth.js';
import type { DeskCallServer } from './app.js';

export function createDeskCallServer(config: ServerConfig): DeskCallServer {
  const db = createDatabase(config);
  const authRepo = createAuthRepository(db);
  const roomStore = createRoomStore(
    {
      createWindowMs: config.ROOM_RATE_LIMIT_WINDOW_MS,
      createMax: config.ROOM_RATE_LIMIT_MAX,
      joinWindowMs: config.ROOM_RATE_LIMIT_WINDOW_MS,
      joinMax: config.ROOM_JOIN_RATE_LIMIT_MAX
    },
    (max) => randomInt(max)
  );

  const app = createHttpApp(config, authRepo, roomStore);
  const httpServer = createHttpServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: config.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(createSocketAuthMiddleware(config));
  attachSocketHandlers(io, roomStore, config);

  return { app, httpServer, io };
}
