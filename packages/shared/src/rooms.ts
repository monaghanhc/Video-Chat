import { z } from 'zod';

export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const roomIdSchema = z
  .string()
  .trim()
  .regex(ROOM_CODE_PATTERN, 'Room codes use six uppercase letters or digits (no I, O, 0, or 1).');

export type RoomId = z.infer<typeof roomIdSchema>;

export const MAX_ROOM_PARTICIPANTS = 4;
