const HTML_TAG_PATTERN = /<[^>]*>/g;
// Intentionally strips ASCII control characters from user-generated text.
// eslint-disable-next-line no-control-regex -- security sanitization
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip HTML/control chars and normalize whitespace for user-generated text. */
export function sanitizeText(input: string, maxLength: number): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(HTML_TAG_PATTERN, '')
    .replace(CONTROL_CHARS_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_SIGNAL_SDP_LENGTH = 64_000;
export const MAX_SOCKET_ID_LENGTH = 64;
