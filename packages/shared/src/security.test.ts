import { describe, expect, it } from 'vitest';
import { sanitizeText } from './security.js';

describe('sanitizeText', () => {
  it('removes html tags and control characters', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>hello', 100)).toBe('hello');
    expect(sanitizeText('a\u0007b', 100)).toBe('ab');
  });

  it('enforces max length', () => {
    expect(sanitizeText('abcdef', 3)).toBe('abc');
  });
});
