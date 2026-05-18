import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import {
  chatMessagePayloadSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from '@deskcall/shared';
import { createRoomStore } from './roomStore.js';

const app = express();
const httpServer = createServer(app);

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const createWindowMs = Number(process.env.ROOM_RATE_LIMIT_WINDOW_MS ?? 60_000);
const createMax = Number(process.env.ROOM_RATE_LIMIT_MAX ?? 20);

const roomStore = createRoomStore(
  {
    createWindowMs,
    createMax
  },
  (max) => randomInt(max)
);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

app.use(
  cors({
    origin: corsOrigin
  })
);
app.use(helmet());
app.use(
  rateLimit({
    windowMs: createWindowMs,
    limit: createMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  })
);

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    rooms: roomStore.getSnapshot().roomCount,
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  console.info(`[socket] connected ${socket.id}`);

  socket.on('room:create', () => {
    const result = roomStore.createRoom(socket.id);

    if (!result.ok) {
      socket.emit('room:error', { code: result.code, message: result.message });
      return;
    }

    socket.join(result.roomId);
    socket.emit('room:created', {
      roomId: result.roomId,
      participants: result.participants
    });

    console.info(`[room] ${socket.id} created ${result.roomId}`);
  });

  socket.on('room:join', ({ roomId }) => {
    const result = roomStore.joinRoom(socket.id, roomId);

    if (!result.ok) {
      socket.emit('room:error', { code: result.code, message: result.message });
      return;
    }

    socket.join(result.roomId);
    socket.emit('room:joined', {
      roomId: result.roomId,
      participants: result.participants
    });
    socket.to(result.roomId).emit('room:participant-joined', {
      roomId: result.roomId,
      participant: result.participant,
      participants: result.participants
    });

    console.info(`[room] ${socket.id} joined ${result.roomId}`);
  });

  socket.on('room:leave', ({ roomId }) => {
    if (!roomStore.isRoomMember(socket.id, roomId)) {
      return;
    }

    socket.leave(roomId);
    const result = roomStore.leaveRoom(socket.id);

    if (!result.ok || result.roomRemoved) {
      return;
    }

    socket.to(result.roomId).emit('room:participant-left', {
      roomId: result.roomId,
      participantId: result.participantId,
      participants: result.participants
    });
    console.info(`[room] ${socket.id} left ${result.roomId}; ${result.participants.length} participant(s) remain`);
  });

  socket.on('signal:offer', (payload) => {
    if (
      !roomStore.isRoomMember(socket.id, payload.roomId) ||
      !roomStore.isPeerInRoom(payload.roomId, payload.targetId) ||
      payload.targetId === socket.id
    ) {
      return;
    }

    io.to(payload.targetId).emit('signal:offer', {
      ...payload,
      fromId: socket.id
    });
    console.info(`[signal] offer ${socket.id} -> ${payload.targetId}`);
  });

  socket.on('signal:answer', (payload) => {
    if (
      !roomStore.isRoomMember(socket.id, payload.roomId) ||
      !roomStore.isPeerInRoom(payload.roomId, payload.targetId) ||
      payload.targetId === socket.id
    ) {
      return;
    }

    io.to(payload.targetId).emit('signal:answer', {
      ...payload,
      fromId: socket.id
    });
    console.info(`[signal] answer ${socket.id} -> ${payload.targetId}`);
  });

  socket.on('signal:ice-candidate', (payload) => {
    if (
      !roomStore.isRoomMember(socket.id, payload.roomId) ||
      !roomStore.isPeerInRoom(payload.roomId, payload.targetId) ||
      payload.targetId === socket.id
    ) {
      return;
    }

    io.to(payload.targetId).emit('signal:ice-candidate', {
      ...payload,
      fromId: socket.id
    });
  });

  socket.on('chat:message', (payload) => {
    const parsedPayload = chatMessagePayloadSchema.safeParse(payload);

    if (!parsedPayload.success || !roomStore.isRoomMember(socket.id, parsedPayload.data.roomId)) {
      return;
    }

    const message = {
      ...parsedPayload.data,
      senderId: socket.id,
      sentAt: Date.now()
    };

    socket.to(message.roomId).emit('chat:message', message);
    console.info(`[chat] ${socket.id} -> ${message.roomId}`);
  });

  socket.on('disconnect', (reason) => {
    const activeRoomId = roomStore.getSocketRoom(socket.id);
    if (activeRoomId) {
      socket.leave(activeRoomId);
    }

    const result = roomStore.clearSocket(socket.id);

    if (result.ok && !result.roomRemoved) {
      socket.to(result.roomId).emit('room:participant-left', {
        roomId: result.roomId,
        participantId: result.participantId,
        participants: result.participants
      });
      console.info(
        `[room] ${socket.id} disconnected from ${result.roomId}; ${result.participants.length} participant(s) remain`
      );
    }

    console.info(`[socket] disconnected ${socket.id} (${reason})`);
  });
});

httpServer.listen(port, () => {
  console.info(`[server] DeskCall signaling server listening on http://localhost:${port}`);
  console.info(`[server] CORS origin: ${corsOrigin}`);
});
