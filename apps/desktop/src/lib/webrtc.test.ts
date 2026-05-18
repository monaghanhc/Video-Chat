import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIceServers, getPreferredMediaConstraints, hasTurnServer } from './webrtc.js';

describe('webrtc helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a public STUN server by default', () => {
    expect(getIceServers()[0]?.urls).toContain('stun:');
    expect(hasTurnServer()).toBe(false);
  });

  it('adds TURN servers when env vars are configured', () => {
    vi.stubEnv('VITE_TURN_URLS', 'turn:turn.example.com');
    vi.stubEnv('VITE_TURN_USERNAME', 'deskcall');
    vi.stubEnv('VITE_TURN_CREDENTIAL', 'secret');

    const servers = getIceServers();
    expect(servers).toHaveLength(2);
    expect(hasTurnServer()).toBe(true);
  });

  it('uses compact constraints on narrow viewports', () => {
    const compact = getPreferredMediaConstraints(640);
    const boundary = getPreferredMediaConstraints(767);
    const desktop = getPreferredMediaConstraints(768);

    expect(compact.video).toMatchObject({ width: { ideal: 640 } });
    expect(boundary.video).toMatchObject({ width: { ideal: 640 } });
    expect(desktop.video).toMatchObject({ width: { ideal: 1280 } });
  });

  it('plays an incoming call tone without throwing', async () => {
    const close = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);

    class AudioContextMock {
      currentTime = 0;
      destination = {};
      resume = resume;
      close = close;
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
      }
      createGain() {
        return {
          gain: { value: 0.0001, exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn()
        };
      }
    }

    vi.stubGlobal('window', {
      AudioContext: AudioContextMock,
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      }
    });

    const { playIncomingCallTone } = await import('./webrtc.js');
    await playIncomingCallTone();

    expect(resume).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
