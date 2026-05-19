import { z } from 'zod';
import { MAX_SIGNAL_SDP_LENGTH, MAX_SOCKET_ID_LENGTH, sanitizeText } from './security.js';
import { roomIdSchema } from './rooms.js';

const socketIdSchema = z.string().trim().min(1).max(MAX_SOCKET_ID_LENGTH);

const rtcDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().max(MAX_SIGNAL_SDP_LENGTH).optional()
});

const rtcCandidateSchema = z.object({
  candidate: z.string().max(8_192).optional(),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional()
});

export const signalOfferPayloadSchema = z.object({
  roomId: roomIdSchema,
  targetId: socketIdSchema,
  fromId: socketIdSchema.optional(),
  description: rtcDescriptionSchema
});

export const signalAnswerPayloadSchema = z.object({
  roomId: roomIdSchema,
  targetId: socketIdSchema,
  fromId: socketIdSchema.optional(),
  description: rtcDescriptionSchema
});

export const signalIceCandidatePayloadSchema = z.object({
  roomId: roomIdSchema,
  targetId: socketIdSchema,
  fromId: socketIdSchema.optional(),
  candidate: rtcCandidateSchema
});

export const roomJoinPayloadSchema = z.object({
  roomId: roomIdSchema
});

export const roomLeavePayloadSchema = z.object({
  roomId: roomIdSchema
});

export const roomBlockPayloadSchema = z.object({
  roomId: roomIdSchema,
  targetId: socketIdSchema
});

export const roomReportPayloadSchema = z.object({
  roomId: roomIdSchema,
  targetId: socketIdSchema,
  reason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .transform((value) => sanitizeText(value, 500))
});
