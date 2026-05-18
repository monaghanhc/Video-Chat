import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard.js';

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for empty text', async () => {
    await expect(copyText('')).resolves.toBe(false);
  });

  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('ABC234')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('ABC234');
  });

  it('falls back to execCommand when clipboard API fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied'))
      }
    });

    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      },
      createElement: vi.fn().mockReturnValue({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn()
      }),
      execCommand
    });

    await expect(copyText('ABC234')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when every copy strategy fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied'))
      }
    });

    vi.stubGlobal('document', {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      },
      createElement: vi.fn().mockReturnValue({
        value: '',
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn()
      }),
      execCommand: vi.fn().mockReturnValue(false)
    });

    await expect(copyText('ABC234')).resolves.toBe(false);
  });
});
