import { describe, expect, it } from 'vitest';
import { createRoomStore } from './roomStore.js';

function deterministicRandom(sequence: number[]): (max: number) => number {
  let index = 0;
  return (max) => {
    const value = sequence[index % sequence.length] ?? 0;
    index += 1;
    return value % max;
  };
}

describe('createRoomStore', () => {
  it('creates unique rooms and tracks membership', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([0, 1, 2, 3, 4, 5])
    );

    const created = store.createRoom('host');
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(created.participants).toHaveLength(1);
    expect(store.getSocketRoom('host')).toBe(created.roomId);
    expect(store.getSnapshot().roomCount).toBe(1);
  });

  it('rejects joining when already in a room', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([0, 1, 2, 3, 4, 5, 6])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    const duplicateJoin = store.joinRoom('host', created.roomId);
    expect(duplicateJoin.ok).toBe(false);
    if (!duplicateJoin.ok) {
      expect(duplicateJoin.code).toBe('ALREADY_IN_ROOM');
    }
  });

  it('prevents creating a room while already in one', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([1, 2, 3, 4, 5, 6])
    );
    store.createRoom('host');

    const second = store.createRoom('host');
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }

    expect(second.code).toBe('ALREADY_IN_ROOM');
  });

  it('enforces create rate limits', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 1 },
      deterministicRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    );

    expect(store.createRoom('host', undefined, 1_000).ok).toBe(true);
    store.leaveRoom('host');
    const limited = store.createRoom('host', undefined, 2_000);
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.code).toBe('RATE_LIMITED');
    }
  });

  it('joins existing rooms until full', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5, maxParticipants: 2 },
      deterministicRandom([0, 1, 2, 3, 4, 5])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    const joined = store.joinRoom('guest', created.roomId);
    expect(joined.ok).toBe(true);

    const full = store.joinRoom('extra', created.roomId);
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expect(full.code).toBe('ROOM_FULL');
    }
  });

  it('rejects invalid and missing room codes', () => {
    const store = createRoomStore({ createWindowMs: 60_000, createMax: 5 });

    const invalid = store.joinRoom('guest', 'bad');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe('INVALID_ROOM');
    }

    const missing = store.joinRoom('guest', 'ABC234');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('ROOM_NOT_FOUND');
    }
  });

  it('removes empty rooms when the last participant leaves', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([2, 3, 4, 5, 6, 7])
    );

    const created = store.createRoom('solo');
    if (!created.ok) {
      throw new Error('expected room');
    }

    const left = store.leaveRoom('solo');
    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.roomRemoved).toBe(true);
      expect(left.participants).toHaveLength(0);
    }

    expect(store.getSnapshot().roomCount).toBe(0);
  });

  it('notifies remaining participants when someone leaves', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5, maxParticipants: 4 },
      deterministicRandom([0, 1, 2, 3, 4, 5, 6, 7, 8])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    store.joinRoom('guest', created.roomId);
    const left = store.leaveRoom('guest');

    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.participants).toHaveLength(1);
      expect(left.roomRemoved).toBe(false);
    }
  });

  it('returns false when leaving a room the socket is not in', () => {
    const store = createRoomStore({ createWindowMs: 60_000, createMax: 5 });
    expect(store.leaveRoom('missing').ok).toBe(false);
  });

  it('returns false when leave is requested twice', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([0, 1, 2, 3, 4, 5])
    );

    store.createRoom('solo');
    expect(store.leaveRoom('solo').ok).toBe(true);
    expect(store.leaveRoom('solo').ok).toBe(false);
  });

  it('clears rate-limit state when a socket disconnects', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 1 },
      deterministicRandom([0, 1, 2, 3, 4, 5])
    );

    expect(store.createRoom('host', undefined, 1_000).ok).toBe(true);
    store.clearSocket('host');
    expect(store.createRoom('host', undefined, 2_000).ok).toBe(true);
  });

  it('enforces join attempt rate limits', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5, joinMax: 1 },
      deterministicRandom([0, 1, 2, 3, 4, 5, 6])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    const firstJoin = store.joinRoom('guest', created.roomId, undefined, 1_000);
    expect(firstJoin.ok).toBe(true);
    store.leaveRoom('guest');

    const limited = store.joinRoom('guest', created.roomId, undefined, 2_000);
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.code).toBe('JOIN_RATE_LIMITED');
    }
  });

  it('blocks peers from joining and signaling', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([2, 3, 4, 5, 6, 7])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    store.blockPeer(created.roomId, 'host', 'blocked-guest');
    const blockedJoin = store.joinRoom('blocked-guest', created.roomId);
    expect(blockedJoin.ok).toBe(false);
    if (!blockedJoin.ok) {
      expect(blockedJoin.code).toBe('BLOCKED');
    }

    store.joinRoom('guest', created.roomId);
    expect(store.isPairBlocked(created.roomId, 'host', 'guest')).toBe(false);
    store.blockPeer(created.roomId, 'host', 'guest');
    expect(store.isPairBlocked(created.roomId, 'host', 'guest')).toBe(true);
  });

  it('tracks peer membership for signaling guards', () => {
    const store = createRoomStore(
      { createWindowMs: 60_000, createMax: 5 },
      deterministicRandom([1, 2, 3, 4, 5, 6])
    );

    const created = store.createRoom('host');
    if (!created.ok) {
      throw new Error('expected room');
    }

    store.joinRoom('guest', created.roomId);
    expect(store.isRoomMember('host', created.roomId)).toBe(true);
    expect(store.isPeerInRoom(created.roomId, 'guest')).toBe(true);
    expect(store.isPeerInRoom(created.roomId, 'unknown')).toBe(false);
  });
});
