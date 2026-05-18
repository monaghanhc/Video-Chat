import { describe, expect, it } from 'vitest';
import {
  formatInviteCode,
  isValidInviteCode,
  ROOM_CODE_LENGTH,
  sanitizeInviteCode
} from './inviteCode.js';

describe('sanitizeInviteCode', () => {
  it('uppercases and strips invalid characters', () => {
    expect(sanitizeInviteCode('ab12io0')).toBe('AB2');
    expect(sanitizeInviteCode('abc-234_test')).toBe('ABC234');
  });

  it('caps length at six characters', () => {
    expect(sanitizeInviteCode('ABCDEFGHJK')).toHaveLength(ROOM_CODE_LENGTH);
  });
});

describe('isValidInviteCode', () => {
  it('requires six valid characters', () => {
    expect(isValidInviteCode('ABC234')).toBe(true);
    expect(isValidInviteCode('ABC23')).toBe(false);
    expect(isValidInviteCode('IOIOIO')).toBe(false);
  });
});

describe('formatInviteCode', () => {
  it('adds spaces between characters', () => {
    expect(formatInviteCode('ABC234')).toBe('A B C 2 3 4');
  });
});
