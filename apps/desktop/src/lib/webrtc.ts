export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ];

  const turnUrls = import.meta.env.VITE_TURN_URLS?.trim();
  const username = import.meta.env.VITE_TURN_USERNAME?.trim();
  const credential = import.meta.env.VITE_TURN_CREDENTIAL?.trim();

  if (turnUrls && username && credential) {
    servers.push({
      urls: turnUrls.split(',').map((url: string) => url.trim()),
      username,
      credential
    });
  }

  return servers;
}

export function hasTurnServer(): boolean {
  return Boolean(
    import.meta.env.VITE_TURN_URLS?.trim() &&
      import.meta.env.VITE_TURN_USERNAME?.trim() &&
      import.meta.env.VITE_TURN_CREDENTIAL?.trim()
  );
}

export type VideoQualityTier = 'high' | 'balanced' | 'low' | 'survival';

export const videoQualityProfiles: Record<
  VideoQualityTier,
  {
    label: string;
    maxBitrate: number;
    scaleResolutionDownBy: number;
  }
> = {
  high: {
    label: 'HD',
    maxBitrate: 1_500_000,
    scaleResolutionDownBy: 1
  },
  balanced: {
    label: 'Balanced',
    maxBitrate: 900_000,
    scaleResolutionDownBy: 1.5
  },
  low: {
    label: 'Low data',
    maxBitrate: 450_000,
    scaleResolutionDownBy: 2
  },
  survival: {
    label: 'Recovery',
    maxBitrate: 220_000,
    scaleResolutionDownBy: 3
  }
};

export function getPreferredMediaConstraints(
  viewportWidth: number = typeof window === 'undefined' ? 1280 : window.innerWidth
): MediaStreamConstraints {
  const compactViewport = viewportWidth < 768;

  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: compactViewport
      ? {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: 'user'
        }
      : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user'
        }
  };
}

export async function playIncomingCallTone(): Promise<void> {
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();
  await context.resume();

  const sequence = [523.25, 659.25, 783.99];
  sequence.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.0001;

    oscillator.connect(gain);
    gain.connect(context.destination);

    const start = context.currentTime + index * 0.18;
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  });

  window.setTimeout(() => {
    void context.close();
  }, 1000);
}
