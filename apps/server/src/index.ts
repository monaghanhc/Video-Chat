import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import {
  chatMessagePayloadSchema,
  roomIdSchema,
  type ClientToServerEvents,
  type ParticipantPresence,
  type RoomId,
  type ServerToClientEvents
} from '@deskcall/shared';

const app = express();
const httpServer = createServer(app);

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const createWindowMs = Number(process.env.ROOM_RATE_LIMIT_WINDOW_MS ?? 60_000);
const createMax = Number(process.env.ROOM_RATE_LIMIT_MAX ?? 20);
const roomAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type DeskCallSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RoomState = Map<string, ParticipantPresence>;

const rooms = new Map<RoomId, RoomState>();
const socketRooms = new Map<string, RoomId>();
const roomCreateEvents = new Map<string, number[]>();

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
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

function generateRoomId(): RoomId {
  while (true) {
    const candidate = Array.from({ length: 6 }, () => roomAlphabet[randomInt(roomAlphabet.length)]).join(
      ''
    ) as RoomId;

    if (!rooms.has(candidate)) {
      return candidate;
    }
  }
}

function participantsFor(roomId: RoomId): ParticipantPresence[] {
  return [...(rooms.get(roomId)?.values() ?? [])];
}

function emitRoomError(
  socket: DeskCallSocket,
  code: 'INVALID_ROOM' | 'ROOM_FULL' | 'ROOM_NOT_FOUND' | 'RATE_LIMITED' | 'ALREADY_IN_ROOM',
  message: string
): void {
  socket.emit('room:error', { code, message });
}

function canCreateRoom(socketId: string): boolean {
  const cutoff = Date.now() - createWindowMs;
  const recent = (roomCreateEvents.get(socketId) ?? []).filter((timestamp) => timestamp > cutoff);

  if (recent.length >= createMax) {
    roomCreateEvents.set(socketId, recent);
    return false;
  }

  recent.push(Date.now());
  roomCreateEvents.set(socketId, recent);
  return true;
}

function leaveRoom(socket: DeskCallSocket, roomId: RoomId): void {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  const leavingParticipant = room.get(socket.id);
  room.delete(socket.id);
  socket.leave(roomId);
  socketRooms.delete(socket.id);

  if (!leavingParticipant) {
    return;
  }

  if (room.size === 0) {
    rooms.delete(roomId);
    console.info(`[room] ${roomId} removed`);
    return;
  }

  const participants = participantsFor(roomId);
  socket.to(roomId).emit('room:participant-left', {
    roomId,
    participantId: leavingParticipant.id,
    participants
  });
  console.info(`[room] ${socket.id} left ${roomId}; ${room.size} participant(s) remain`);
}

function ensureRoomMembership(socket: DeskCallSocket, roomId: RoomId): boolean {
  return socketRooms.get(socket.id) === roomId && rooms.has(roomId);
}

io.on('connection', (socket) => {
  console.info(`[socket] connected ${socket.id}`);

  socket.on('room:create', () => {
    if (socketRooms.has(socket.id)) {
      emitRoomError(socket, 'ALREADY_IN_ROOM', 'Leave your current room before creating another one.');
      return;
    }

    if (!canCreateRoom(socket.id)) {
      emitRoomError(socket, 'RATE_LIMITED', 'Too many rooms created too quickly. Try again soon.');
      return;
    }

    const roomId = generateRoomId();
    const participant: ParticipantPresence = {
      id: socket.id,
      joinedAt: Date.now()
    };

    rooms.set(roomId, new Map([[socket.id, participant]]));
    socketRooms.set(socket.id, roomId);
    socket.join(roomId);
    socket.emit('room:created', {
      roomId,
      participants: [participant]
    });

    console.info(`[room] ${socket.id} created ${roomId}`);
  });

  socket.on('room:join', ({ roomId }) => {
    const parsedRoomId = roomIdSchema.safeParse(roomId);

    if (!parsedRoomId.success) {
      emitRoomError(socket, 'INVALID_ROOM', parsedRoomId.error.issues[0]?.message ?? 'Invalid room code.');
      return;
    }

    if (socketRooms.has(socket.id)) {
      emitRoomError(socket, 'ALREADY_IN_ROOM', 'Leave your current room before joining another one.');
      return;
    }

    const room = rooms.get(parsedRoomId.data);

    if (!room) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'That room does not exist yet.');
      return;
    }

    if (room.size >= 2) {
      emitRoomError(socket, 'ROOM_FULL', 'DeskCall beta rooms support two participants.');
      return;
    }

    const participant: ParticipantPresence = {
      id: socket.id,
      joinedAt: Date.now()
    };

    room.set(socket.id, participant);
    socketRooms.set(socket.id, parsedRoomId.data);
    socket.join(parsedRoomId.data);

    const participants = participantsFor(parsedRoomId.data);
    socket.emit('room:joined', {
      roomId: parsedRoomId.data,
      participants
    });
    socket.to(parsedRoomId.data).emit('room:participant-joined', {
      roomId: parsedRoomId.data,
      participant,
      participants
    });

    console.info(`[room] ${socket.id} joined ${parsedRoomId.data}`);
  });

  socket.on('room:leave', ({ roomId }) => {
    const parsedRoomId = roomIdSchema.safeParse(roomId);

    if (!parsedRoomId.success) {
      return;
    }

    leaveRoom(socket, parsedRoomId.data);
  });

  socket.on('signal:offer', (payload) => {
    if (!ensureRoomMembership(socket, payload.roomId)) {
      return;
    }

    socket.to(payload.roomId).emit('signal:offer', payload);
    console.info(`[signal] offer ${socket.id} -> ${payload.roomId}`);
  });

  socket.on('signal:answer', (payload) => {
    if (!ensureRoomMembership(socket, payload.roomId)) {
      return;
    }

    socket.to(payload.roomId).emit('signal:answer', payload);
    console.info(`[signal] answer ${socket.id} -> ${payload.roomId}`);
  });

  socket.on('signal:ice-candidate', (payload) => {
    if (!ensureRoomMembership(socket, payload.roomId)) {
      return;
    }

    socket.to(payload.roomId).emit('signal:ice-candidate', payload);
  });

  socket.on('chat:message', (payload) => {
    const parsedPayload = chatMessagePayloadSchema.safeParse(payload);

    if (!parsedPayload.success || !ensureRoomMembership(socket, parsedPayload.data.roomId)) {
      return;
    }

    const message = {
      ...parsedPayload.data,
      sentAt: Date.now()
    };

    socket.to(message.roomId).emit('chat:message', message);
    console.info(`[chat] ${socket.id} -> ${message.roomId}`);
  });

  socket.on('disconnect', (reason) => {
    const roomId = socketRooms.get(socket.id);

    if (roomId) {
      leaveRoom(socket, roomId);
    }

    roomCreateEvents.delete(socket.id);
    console.info(`[socket] disconnected ${socket.id} (${reason})`);
  });
});

httpServer.listen(port, () => {
  console.info(`[server] DeskCall signaling server listening on http://localhost:${port}`);
  console.info(`[server] CORS origin: ${corsOrigin}`);
  // Production auth would be added before room admission and signaling dispatch.
});
