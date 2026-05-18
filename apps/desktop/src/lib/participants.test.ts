import { describe, expect, it } from 'vitest';
import { shortParticipantLabel } from './participants.js';

describe('shortParticipantLabel', () => {
  it('uses the last four characters of the socket id', () => {
    expect(shortParticipantLabel('socket-abcdef12')).toBe('Guest EF12');
  });
});
