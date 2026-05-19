import { describe, expect, it } from 'vitest';
import { signalOfferPayloadSchema } from './signals.js';

describe('signalOfferPayloadSchema', () => {
  it('accepts valid offer payloads', () => {
    const parsed = signalOfferPayloadSchema.safeParse({
      roomId: 'ABCDEF',
      targetId: 'socket-1',
      description: { type: 'offer', sdp: 'v=0' }
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects oversized sdp', () => {
    const parsed = signalOfferPayloadSchema.safeParse({
      roomId: 'ABCDEF',
      targetId: 'socket-1',
      description: { type: 'offer', sdp: 'x'.repeat(70_000) }
    });

    expect(parsed.success).toBe(false);
  });
});
