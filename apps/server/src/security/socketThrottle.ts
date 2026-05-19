export function createSocketThrottle(maxEvents: number, windowMs: number) {
  const events = new Map<string, number[]>();

  function allow(socketId: string, eventName: string, now = Date.now()): boolean {
    const key = `${socketId}:${eventName}`;
    const cutoff = now - windowMs;
    const recent = (events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= maxEvents) {
      events.set(key, recent);
      return false;
    }

    recent.push(now);
    events.set(key, recent);
    return true;
  }

  function clearSocket(socketId: string): void {
    for (const key of events.keys()) {
      if (key.startsWith(`${socketId}:`)) {
        events.delete(key);
      }
    }
  }

  return { allow, clearSocket };
}
