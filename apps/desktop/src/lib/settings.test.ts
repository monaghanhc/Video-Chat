import { describe, expect, it } from 'vitest';
import { normalizePersistedSettings } from './settings.js';

const defaults = {
  signalingServerUrl: 'https://deskcall-signaling.onrender.com'
};

describe('normalizePersistedSettings', () => {
  it('merges stored settings with defaults', () => {
    expect(
      normalizePersistedSettings(
        { preferredCameraId: 'cam-1' },
        defaults,
        'deskcall.example'
      ).preferredCameraId
    ).toBe('cam-1');
  });

  it('replaces localhost signaling URLs on production hosts', () => {
    expect(
      normalizePersistedSettings(
        { signalingServerUrl: 'http://localhost:4000' },
        defaults,
        'monaghanhc.github.io'
      ).signalingServerUrl
    ).toBe(defaults.signalingServerUrl);
  });

  it('keeps localhost signaling URLs during local development', () => {
    expect(
      normalizePersistedSettings(
        { signalingServerUrl: 'http://127.0.0.1:4000' },
        defaults,
        'localhost'
      ).signalingServerUrl
    ).toBe('http://127.0.0.1:4000');
  });
});
