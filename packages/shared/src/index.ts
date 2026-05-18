import { z } from 'zod';

export const roomIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Z2-9]{6}$/, 'Room codes use six uppercase letters or digits.');

export type RoomId = z.infer<typeof roomIdSchema>;

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
    | 'ALREADY_IN_ROOM'
    | 'UNKNOWN';
  message: string;
}

export interface SignalOfferPayload {
  roomId: RoomId;
  description: RTCSessionDescriptionInit;
}

export interface SignalAnswerPayload {
  roomId: RoomId;
  description: RTCSessionDescriptionInit;
}

export interface SignalIceCandidatePayload {
  roomId: RoomId;
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

export interface ServerToClientEvents {
  'room:created': (payload: RoomCreatedPayload) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:error': (payload: RoomErrorPayload) => void;
  'room:participant-joined': (payload: ParticipantEventPayload) => void;
  'room:participant-left': (payload: PeerDisconnectedPayload) => void;
  'signal:offer': (payload: SignalOfferPayload) => void;
  'signal:answer': (payload: SignalAnswerPayload) => void;
  'signal:ice-candidate': (payload: SignalIceCandidatePayload) => void;
}

export interface ClientToServerEvents {
  'room:create': () => void;
  'room:join': (payload: { roomId: RoomId }) => void;
  'room:leave': (payload: { roomId: RoomId }) => void;
  'signal:offer': (payload: SignalOfferPayload) => void;
  'signal:answer': (payload: SignalAnswerPayload) => void;
  'signal:ice-candidate': (payload: SignalIceCandidatePayload) => void;
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
  body: string;
  sentAt: number;
}

