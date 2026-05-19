import { z } from 'zod';
import { MAX_DISPLAY_NAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './security.js';

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Display name must be at least 2 characters.')
  .max(MAX_DISPLAY_NAME_LENGTH);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH)
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH);

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema
});

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;

export interface AuthUserPublic {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  expiresIn: number;
  user?: AuthUserPublic;
}
