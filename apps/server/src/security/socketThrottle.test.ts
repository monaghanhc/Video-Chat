import { describe, expect, it } from 'vitest';
import { createSocketThrottle } from './socketThrottle.js';

describe('createSocketThrottle', () => {
  it('limits events per window', () => {
    const throttle = createSocketThrottle(2, 60_000);
    expect(throttle.allow('socket-1', 'chat:message', 1_000)).toBe(true);
    expect(throttle.allow('socket-1', 'chat:message', 2_000)).toBe(true);
    expect(throttle.allow('socket-1', 'chat:message', 3_000)).toBe(false);
  });

  it('clears state when a socket disconnects', () => {
    const throttle = createSocketThrottle(1, 60_000);
    expect(throttle.allow('socket-1', 'chat:message', 1_000)).toBe(true);
    throttle.clearSocket('socket-1');
    expect(throttle.allow('socket-1', 'chat:message', 2_000)).toBe(true);
  });
});
