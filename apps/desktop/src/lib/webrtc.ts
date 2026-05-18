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
