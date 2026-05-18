import { describe, expect, it } from 'vitest';
import {
  countExpectedPeers,
  deriveConnectionStatus,
  participantLeftMessage,
  shouldUseDataChannel
} from './callState.js';

describe('callState helpers', () => {
  const participants = [
    { id: 'self', joinedAt: 1 },
    { id: 'peer-a', joinedAt: 2 },
    { id: 'peer-b', joinedAt: 3 }
  ];

  it('counts expected peers excluding self', () => {
    expect(countExpectedPeers(participants, 'self')).toBe(2);
    expect(countExpectedPeers(participants, null)).toBe(0);
  });

  it('derives waiting status when alone', () => {
    expect(deriveConnectionStatus([{ id: 'self', joinedAt: 1 }], 'self', 0, 0)).toBe('waiting');
  });

  it('derives connected status when all peers are connected', () => {
    expect(deriveConnectionStatus(participants, 'self', 2, 0)).toBe('connected');
  });

  it('derives connecting status while handshakes are in flight', () => {
    expect(deriveConnectionStatus(participants, 'self', 1, 1)).toBe('connecting');
  });

  it('stays connecting before any peer link is live', () => {
    expect(deriveConnectionStatus(participants, 'self', 0, 0)).toBe('connecting');
  });

  it('enables data channels only for two-person rooms', () => {
    expect(shouldUseDataChannel(2)).toBe(true);
    expect(shouldUseDataChannel(3)).toBe(false);
  });

  it('returns a message only when the room is empty', () => {
    expect(participantLeftMessage(1)).toMatch(/left/);
    expect(participantLeftMessage(2)).toBeNull();
  });
});
