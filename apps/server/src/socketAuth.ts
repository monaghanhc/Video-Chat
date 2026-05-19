import type { Socket } from 'socket.io';
import type { ServerConfig } from './config.js';
import { auditLog } from './security/auditLog.js';
import { verifyAccessToken } from './auth/tokens.js';

export interface SocketAuthData {
  subjectId: string;
  tokenType: 'user' | 'guest';
  role?: 'user' | 'admin';
  displayName?: string;
}

declare module 'socket.io' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Socket.IO merges SocketData
  interface SocketData extends SocketAuthData {}
}

export function createSocketAuthMiddleware(config: ServerConfig) {
  return (socket: Socket, next: (error?: Error) => void) => {
    const token =
      (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
      extractBearer(socket.handshake.headers.authorization);

    if (!token) {
      if (config.AUTH_MODE === 'required') {
        auditLog('socket.unauthorized', { reason: 'missing_token', socketId: socket.id });
        next(new Error('Authentication required.'));
        return;
      }

      next(new Error('Missing access token. Request POST /auth/guest first.'));
      return;
    }

    const verified = verifyAccessToken(config, token);
    if (!verified) {
      auditLog('socket.unauthorized', { reason: 'invalid_token', socketId: socket.id });
      next(new Error('Invalid access token.'));
      return;
    }

    socket.data.subjectId = verified.sub;
    socket.data.tokenType = verified.type;
    socket.data.role = verified.role;
    socket.data.displayName = verified.displayName;
    next();
  };
}

function extractBearer(header: string | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice(7);
}
