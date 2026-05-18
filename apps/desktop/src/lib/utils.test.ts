import { describe, expect, it } from 'vitest';
import { cn, formatTime } from './utils.js';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', undefined, 'px-4')).toBe('px-4');
  });
});

describe('formatTime', () => {
  it('formats timestamps for display', () => {
    const formatted = formatTime(Date.UTC(2026, 4, 18, 14, 30));
    expect(formatted.length).toBeGreaterThan(0);
  });
});
