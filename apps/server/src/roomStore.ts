import { MAX_ROOM_PARTICIPANTS, roomIdSchema, type ParticipantPresence, type RoomId } from '@deskcall/shared';

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type RoomErrorCode =
  | 'INVALID_ROOM'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'JOIN_RATE_LIMITED'
  | 'ALREADY_IN_ROOM'
  | 'BLOCKED';

export interface RoomStoreConfig {
  maxParticipants?: number;
  createWindowMs: number;
  createMax: number;
  joinWindowMs?: number;
  joinMax?: number;
}

export interface RoomStoreSnapshot {
  roomCount: number;
}

export interface ParticipantMeta {
  displayName?: string;
  userId?: string;
}

type RoomState = Map<string, ParticipantPresence>;

export type RandomInt = (max: number) => number;

export function createRoomStore(
  config: RoomStoreConfig,
  randomInt: RandomInt = (max) => Math.floor(Math.random() * max)
) {
  const maxParticipants = config.maxParticipants ?? MAX_ROOM_PARTICIPANTS;
  const joinWindowMs = config.joinWindowMs ?? config.createWindowMs;
  const joinMax = config.joinMax ?? 30;
  const rooms = new Map<RoomId, RoomState>();
  const socketRooms = new Map<string, RoomId>();
  const roomCreateEvents = new Map<string, number[]>();
  const roomJoinEvents = new Map<string, number[]>();
  const roomBlocks = new Map<RoomId, Map<string, Set<string>>>();

  function participantsFor(roomId: RoomId): ParticipantPresence[] {
    return [...(rooms.get(roomId)?.values() ?? [])];
  }

  function buildParticipant(socketId: string, now: number, meta?: ParticipantMeta): ParticipantPresence {
    return {
      id: socketId,
      joinedAt: now,
      ...(meta?.displayName ? { displayName: meta.displayName } : {}),
      ...(meta?.userId ? { userId: meta.userId } : {})
    };
  }

  function generateRoomId(): RoomId {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = Array.from(
        { length: 6 },
        () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]
      ).join('') as RoomId;

      if (!rooms.has(candidate)) {
        return candidate;
      }
    }

    throw new Error('Unable to allocate a unique room code.');
  }

  function trackEvent(bucket: Map<string, number[]>, socketId: string, windowMs: number, max: number, now: number): boolean {
    const cutoff = now - windowMs;
    const recent = (bucket.get(socketId) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= max) {
      bucket.set(socketId, recent);
      return false;
    }

    recent.push(now);
    bucket.set(socketId, recent);
    return true;
  }

  function canCreateRoom(socketId: string, now = Date.now()): boolean {
    return trackEvent(roomCreateEvents, socketId, config.createWindowMs, config.createMax, now);
  }

  function canAttemptJoin(socketId: string, now = Date.now()): boolean {
    return trackEvent(roomJoinEvents, socketId, joinWindowMs, joinMax, now);
  }

  function getSocketRoom(socketId: string): RoomId | undefined {
    return socketRooms.get(socketId);
  }

  function isPeerInRoom(roomId: RoomId, peerId: string): boolean {
    return rooms.get(roomId)?.has(peerId) ?? false;
  }

  function isRoomMember(socketId: string, roomId: RoomId): boolean {
    return socketRooms.get(socketId) === roomId && rooms.has(roomId);
  }

  function isBlocked(roomId: RoomId, actorId: string, targetId: string): boolean {
    const blocks = roomBlocks.get(roomId);
    if (!blocks) {
      return false;
    }

    return blocks.get(actorId)?.has(targetId) ?? false;
  }

  function isPairBlocked(roomId: RoomId, a: string, b: string): boolean {
    return isBlocked(roomId, a, b) || isBlocked(roomId, b, a);
  }

  function blockPeer(roomId: RoomId, actorId: string, targetId: string): boolean {
    if (!isRoomMember(actorId, roomId) || !rooms.has(roomId)) {
      return false;
    }

    const blocks = roomBlocks.get(roomId) ?? new Map<string, Set<string>>();
    const actorBlocks = blocks.get(actorId) ?? new Set<string>();
    actorBlocks.add(targetId);
    blocks.set(actorId, actorBlocks);
    roomBlocks.set(roomId, blocks);
    return true;
  }

  function unblockPeer(roomId: RoomId, actorId: string, targetId: string): boolean {
    const blocks = roomBlocks.get(roomId);
    if (!blocks) {
      return false;
    }

    blocks.get(actorId)?.delete(targetId);
    return true;
  }

  function createRoom(
    socketId: string,
    meta?: ParticipantMeta,
    now = Date.now()
  ):
    | { ok: true; roomId: RoomId; participants: ParticipantPresence[] }
    | { ok: false; code: RoomErrorCode; message: string } {
    if (socketRooms.has(socketId)) {
      return {
        ok: false,
        code: 'ALREADY_IN_ROOM',
        message: 'Leave your current room before creating another one.'
      };
    }

    if (!canCreateRoom(socketId, now)) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many rooms created too quickly. Try again soon.'
      };
    }

    const roomId = generateRoomId();
    const participant = buildParticipant(socketId, now, meta);

    rooms.set(roomId, new Map([[socketId, participant]]));
    socketRooms.set(socketId, roomId);

    return {
      ok: true,
      roomId,
      participants: [participant]
    };
  }

  function joinRoom(
    socketId: string,
    rawRoomId: string,
    meta?: ParticipantMeta,
    now = Date.now()
  ):
    | {
        ok: true;
        roomId: RoomId;
        participant: ParticipantPresence;
        participants: ParticipantPresence[];
      }
    | { ok: false; code: RoomErrorCode; message: string } {
    if (!canAttemptJoin(socketId, now)) {
      return {
        ok: false,
        code: 'JOIN_RATE_LIMITED',
        message: 'Too many join attempts. Wait a moment and try again.'
      };
    }

    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);

    if (!parsedRoomId.success) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        message: parsedRoomId.error.issues[0]?.message ?? 'Invalid room code.'
      };
    }

    if (socketRooms.has(socketId)) {
      return {
        ok: false,
        code: 'ALREADY_IN_ROOM',
        message: 'Leave your current room before joining another one.'
      };
    }

    const room = rooms.get(parsedRoomId.data);

    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        message: 'That room does not exist yet.'
      };
    }

    for (const participant of room.values()) {
      if (isBlocked(parsedRoomId.data, participant.id, socketId)) {
        return {
          ok: false,
          code: 'BLOCKED',
          message: 'You cannot join this room.'
        };
      }
    }

    if (room.size >= maxParticipants) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        message: `DeskCall rooms support up to ${maxParticipants} participants.`
      };
    }

    const participant = buildParticipant(socketId, now, meta);

    room.set(socketId, participant);
    socketRooms.set(socketId, parsedRoomId.data);

    return {
      ok: true,
      roomId: parsedRoomId.data,
      participant,
      participants: participantsFor(parsedRoomId.data)
    };
  }

  function leaveRoom(socketId: string):
    | {
        ok: true;
        roomId: RoomId;
        participantId: string;
        participants: ParticipantPresence[];
        roomRemoved: boolean;
      }
    | { ok: false } {
    const roomId = socketRooms.get(socketId);
    if (!roomId) {
      return { ok: false };
    }

    const room = rooms.get(roomId);
    if (!room) {
      socketRooms.delete(socketId);
      return { ok: false };
    }

    const leavingParticipant = room.get(socketId);
    room.delete(socketId);
    socketRooms.delete(socketId);

    if (!leavingParticipant) {
      return { ok: false };
    }

    if (room.size === 0) {
      rooms.delete(roomId);
      roomBlocks.delete(roomId);
      return {
        ok: true,
        roomId,
        participantId: leavingParticipant.id,
        participants: [],
        roomRemoved: true
      };
    }

    return {
      ok: true,
      roomId,
      participantId: leavingParticipant.id,
      participants: participantsFor(roomId),
      roomRemoved: false
    };
  }

  function clearSocket(socketId: string): ReturnType<typeof leaveRoom> {
    roomCreateEvents.delete(socketId);
    roomJoinEvents.delete(socketId);
    return leaveRoom(socketId);
  }

  function getSnapshot(): RoomStoreSnapshot {
    return { roomCount: rooms.size };
  }

  return {
    createRoom,
    joinRoom,
    leaveRoom,
    clearSocket,
    canCreateRoom,
    canAttemptJoin,
    generateRoomId,
    participantsFor,
    getSocketRoom,
    isPeerInRoom,
    isRoomMember,
    isPairBlocked,
    blockPeer,
    unblockPeer,
    getSnapshot
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
