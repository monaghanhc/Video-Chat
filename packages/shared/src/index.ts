import { z } from 'zod';
import { sanitizeText } from './security.js';
import { roomIdSchema, type RoomId } from './rooms.js';

export * from './security.js';
export * from './rooms.js';
export * from './auth.js';
export * from './signals.js';

export type ConnectionStatus =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface ParticipantPresence {
  id: string;
  joinedAt: number;
  displayName?: string;
  userId?: string;
}

export interface RoomCreatedPayload {
  roomId: RoomId;
  participants: ParticipantPresence[];
}

export interface RoomJoinedPayload {
  roomId: RoomId;
  participants: ParticipantPresence[];
}

export interface RoomErrorPayload {
  code:
    | 'INVALID_ROOM'
    | 'ROOM_FULL'
    | 'ROOM_NOT_FOUND'
    | 'RATE_LIMITED'
    | 'JOIN_RATE_LIMITED'
    | 'ALREADY_IN_ROOM'
    | 'UNAUTHORIZED'
    | 'BLOCKED'
    | 'UNKNOWN';
  message: string;
}

export interface SignalOfferPayload {
  roomId: RoomId;
  targetId: string;
  fromId?: string;
  description: RTCSessionDescriptionInit;
}

export interface SignalAnswerPayload {
  roomId: RoomId;
  targetId: string;
  fromId?: string;
  description: RTCSessionDescriptionInit;
}

export interface SignalIceCandidatePayload {
  roomId: RoomId;
  targetId: string;
  fromId?: string;
  candidate: RTCIceCandidateInit;
}

export interface ParticipantEventPayload {
  roomId: RoomId;
  participant: ParticipantPresence;
  participants: ParticipantPresence[];
}

export interface PeerDisconnectedPayload {
  roomId: RoomId;
  participantId: string;
  participants: ParticipantPresence[];
}

export const chatMessageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .transform((value) => sanitizeText(value, 1000));

export const chatMessagePayloadSchema = z.object({
  roomId: roomIdSchema,
  id: z.string().uuid(),
  body: chatMessageBodySchema,
  sentAt: z.number().int().nonnegative()
});

export type ChatMessagePayload = z.infer<typeof chatMessagePayloadSchema> & {
  senderId?: string;
};

export interface RoomBlockPayload {
  roomId: RoomId;
  targetId: string;
}

export interface ServerToClientEvents {
  'room:created': (payload: RoomCreatedPayload) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:error': (payload: RoomErrorPayload) => void;
  'room:participant-joined': (payload: ParticipantEventPayload) => void;
  'room:participant-left': (payload: PeerDisconnectedPayload) => void;
  'signal:offer': (payload: SignalOfferPayload) => void;
  'signal:answer': (payload: SignalAnswerPayload) => void;
  'signal:ice-candidate': (payload: SignalIceCandidatePayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
}

export interface ClientToServerEvents {
  'room:create': () => void;
  'room:join': (payload: { roomId: RoomId }) => void;
  'room:leave': (payload: { roomId: RoomId }) => void;
  'signal:offer': (payload: SignalOfferPayload) => void;
  'signal:answer': (payload: SignalAnswerPayload) => void;
  'signal:ice-candidate': (payload: SignalIceCandidatePayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  'room:block': (payload: RoomBlockPayload) => void;
  'room:unblock': (payload: RoomBlockPayload) => void;
  'room:report': (payload: { roomId: RoomId; targetId: string; reason: string }) => void;
}

export interface AppSettings {
  signalingServerUrl: string;
  preferredCameraId?: string;
  preferredMicrophoneId?: string;
  preferredSpeakerId?: string;
}

export interface ChatMessage {
  id: string;
  author: 'me' | 'peer';
  senderId?: string;
  body: string;
  sentAt: number;
}
