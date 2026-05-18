/** Matches the signaling server's room code alphabet (no I, O, 0, or 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function sanitizeInviteCode(raw: string): string {
  const upper = raw.toUpperCase();
  let sanitized = '';

  for (const character of upper) {
    if (ROOM_CODE_ALPHABET.includes(character)) {
      sanitized += character;
      if (sanitized.length >= ROOM_CODE_LENGTH) {
        break;
      }
    }
  }

  return sanitized;
}

export function isValidInviteCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) {
    return false;
  }

  return [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

export function formatInviteCode(code: string): string {
  return sanitizeInviteCode(code).split('').join(' ');
}
