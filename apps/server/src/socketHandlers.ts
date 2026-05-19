import type { Server, Socket } from 'socket.io';
import {
  chatMessagePayloadSchema,
  roomBlockPayloadSchema,
  roomJoinPayloadSchema,
  roomLeavePayloadSchema,
  roomReportPayloadSchema,
  signalAnswerPayloadSchema,
  signalIceCandidatePayloadSchema,
  signalOfferPayloadSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from '@deskcall/shared';
import type { ServerConfig } from './config.js';
import type { RoomStore } from './roomStore.js';
import { auditLog } from './security/auditLog.js';
import { createSocketThrottle } from './security/socketThrottle.js';

type DeskCallServer = Server<ClientToServerEvents, ServerToClientEvents>;
type DeskCallSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function attachSocketHandlers(
  io: DeskCallServer,
  roomStore: RoomStore,
  config: ServerConfig
) {
  const throttle = createSocketThrottle(config.SOCKET_EVENT_RATE_LIMIT_MAX, config.ROOM_RATE_LIMIT_WINDOW_MS);

  function participantMeta(socket: DeskCallSocket) {
    return {
      displayName: socket.data.displayName,
      userId: socket.data.tokenType === 'user' ? socket.data.subjectId : undefined
    };
  }

  function guardEvent(socket: DeskCallSocket, eventName: string): boolean {
    if (!throttle.allow(socket.id, eventName)) {
      auditLog('socket.rate_limited', { socketId: socket.id, event: eventName });
      return false;
    }

    return true;
  }

  function canSignal(socket: DeskCallSocket, roomId: string, targetId: string): boolean {
    return (
      roomStore.isRoomMember(socket.id, roomId) &&
      roomStore.isPeerInRoom(roomId, targetId) &&
      targetId !== socket.id &&
      !roomStore.isPairBlocked(roomId, socket.id, targetId)
    );
  }

  io.on('connection', (socket) => {
    console.info(`[socket] connected ${socket.id} (${socket.data.tokenType}:${socket.data.subjectId})`);

    socket.on('room:create', () => {
      if (!guardEvent(socket, 'room:create')) {
        return;
      }

      const result = roomStore.createRoom(socket.id, participantMeta(socket));

      if (!result.ok) {
        socket.emit('room:error', { code: result.code, message: result.message });
        return;
      }

      socket.join(result.roomId);
      socket.emit('room:created', {
        roomId: result.roomId,
        participants: result.participants
      });
      auditLog('room.create', { roomId: result.roomId, socketId: socket.id });
    });

    socket.on('room:join', (payload) => {
      if (!guardEvent(socket, 'room:join')) {
        return;
      }

      const parsed = roomJoinPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('room:error', {
          code: 'INVALID_ROOM',
          message: 'Invalid room join payload.'
        });
        return;
      }

      const result = roomStore.joinRoom(socket.id, parsed.data.roomId, participantMeta(socket));

      if (!result.ok) {
        auditLog('room.join.failure', {
          roomId: parsed.data.roomId,
          socketId: socket.id,
          code: result.code
        });
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
      auditLog('room.join.success', { roomId: result.roomId, socketId: socket.id });
    });

    socket.on('room:leave', (payload) => {
      if (!guardEvent(socket, 'room:leave')) {
        return;
      }

      const parsed = roomLeavePayloadSchema.safeParse(payload);
      if (!parsed.success || !roomStore.isRoomMember(socket.id, parsed.data.roomId)) {
        return;
      }

      socket.leave(parsed.data.roomId);
      const result = roomStore.leaveRoom(socket.id);

      if (!result.ok || result.roomRemoved) {
        return;
      }

      socket.to(result.roomId).emit('room:participant-left', {
        roomId: result.roomId,
        participantId: result.participantId,
        participants: result.participants
      });
    });

    socket.on('signal:offer', (payload) => {
      if (!guardEvent(socket, 'signal:offer')) {
        return;
      }

      const parsed = signalOfferPayloadSchema.safeParse(payload);
      if (!parsed.success || !canSignal(socket, parsed.data.roomId, parsed.data.targetId)) {
        return;
      }

      io.to(parsed.data.targetId).emit('signal:offer', {
        roomId: parsed.data.roomId,
        targetId: parsed.data.targetId,
        description: parsed.data.description,
        fromId: socket.id
      });
    });

    socket.on('signal:answer', (payload) => {
      if (!guardEvent(socket, 'signal:answer')) {
        return;
      }

      const parsed = signalAnswerPayloadSchema.safeParse(payload);
      if (!parsed.success || !canSignal(socket, parsed.data.roomId, parsed.data.targetId)) {
        return;
      }

      io.to(parsed.data.targetId).emit('signal:answer', {
        roomId: parsed.data.roomId,
        targetId: parsed.data.targetId,
        description: parsed.data.description,
        fromId: socket.id
      });
    });

    socket.on('signal:ice-candidate', (payload) => {
      if (!guardEvent(socket, 'signal:ice-candidate')) {
        return;
      }

      const parsed = signalIceCandidatePayloadSchema.safeParse(payload);
      if (!parsed.success || !canSignal(socket, parsed.data.roomId, parsed.data.targetId)) {
        return;
      }

      io.to(parsed.data.targetId).emit('signal:ice-candidate', {
        roomId: parsed.data.roomId,
        targetId: parsed.data.targetId,
        candidate: parsed.data.candidate,
        fromId: socket.id
      });
    });

    socket.on('chat:message', (payload) => {
      if (!guardEvent(socket, 'chat:message')) {
        return;
      }

      const parsedPayload = chatMessagePayloadSchema.safeParse(payload);

      if (!parsedPayload.success || !roomStore.isRoomMember(socket.id, parsedPayload.data.roomId)) {
        return;
      }

      const message = {
        ...parsedPayload.data,
        senderId: socket.id,
        sentAt: Date.now()
      };

      const roomId = parsedPayload.data.roomId;
      const roomMembers = roomStore.participantsFor(roomId);

      for (const member of roomMembers) {
        if (member.id === socket.id) {
          continue;
        }

        if (roomStore.isPairBlocked(roomId, socket.id, member.id)) {
          continue;
        }

        io.to(member.id).emit('chat:message', message);
      }
    });

    socket.on('room:block', (payload) => {
      if (!guardEvent(socket, 'room:block')) {
        return;
      }

      const parsed = roomBlockPayloadSchema.safeParse(payload);
      if (!parsed.success || !roomStore.blockPeer(parsed.data.roomId, socket.id, parsed.data.targetId)) {
        return;
      }

      auditLog('room.block', { roomId: parsed.data.roomId, actorId: socket.id, targetId: parsed.data.targetId });
    });

    socket.on('room:unblock', (payload) => {
      if (!guardEvent(socket, 'room:unblock')) {
        return;
      }

      const parsed = roomBlockPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }

      roomStore.unblockPeer(parsed.data.roomId, socket.id, parsed.data.targetId);
    });

    socket.on('room:report', (payload) => {
      if (!guardEvent(socket, 'room:report')) {
        return;
      }

      const parsed = roomReportPayloadSchema.safeParse(payload);
      if (!parsed.success || !roomStore.isRoomMember(socket.id, parsed.data.roomId)) {
        return;
      }

      auditLog('room.report', {
        roomId: parsed.data.roomId,
        reporterId: socket.id,
        targetId: parsed.data.targetId,
        reason: parsed.data.reason
      });
    });

    socket.on('disconnect', (reason) => {
      throttle.clearSocket(socket.id);
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
      }

      console.info(`[socket] disconnected ${socket.id} (${reason})`);
    });
  });

}
