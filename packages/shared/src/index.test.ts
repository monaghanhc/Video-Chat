import { describe, expect, it } from 'vitest';
import { chatMessagePayloadSchema, MAX_ROOM_PARTICIPANTS, roomIdSchema } from './index.js';

describe('roomIdSchema', () => {
  it('accepts valid room codes', () => {
    expect(roomIdSchema.parse('ABC234')).toBe('ABC234');
    expect(roomIdSchema.parse('  XYZ789  ')).toBe('XYZ789');
  });

  it('rejects invalid characters and lengths', () => {
    expect(roomIdSchema.safeParse('abc234').success).toBe(false);
    expect(roomIdSchema.safeParse('AB12').success).toBe(false);
    expect(roomIdSchema.safeParse('ABCDEFG').success).toBe(false);
    expect(roomIdSchema.safeParse('IOIOIO').success).toBe(false);
  });
});

describe('chatMessagePayloadSchema', () => {
  it('validates chat payloads', () => {
    const payload = {
      roomId: 'ABC234',
      id: '550e8400-e29b-41d4-a716-446655440000',
      body: 'Hello',
      sentAt: Date.now()
    };

    expect(chatMessagePayloadSchema.parse(payload)).toMatchObject({
      body: 'Hello',
      roomId: 'ABC234'
    });
  });

  it('rejects empty bodies', () => {
    expect(
      chatMessagePayloadSchema.safeParse({
        roomId: 'ABC234',
        id: '550e8400-e29b-41d4-a716-446655440000',
        body: '   ',
        sentAt: 0
      }).success
    ).toBe(false);
  });
});

describe('constants', () => {
  it('allows four participants per room', () => {
    expect(MAX_ROOM_PARTICIPANTS).toBe(4);
  });
});
