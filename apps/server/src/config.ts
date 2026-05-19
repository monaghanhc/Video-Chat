import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_PATH: z.string().min(1).default('./data/deskcall.db'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  AUTH_MODE: z.enum(['optional', 'required']).default('optional'),
  ROOM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  ROOM_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  ROOM_JOIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  SOCKET_EVENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(15),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === '1' || value === 'true'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === '1' || value === 'true')
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid server environment: ${details}`);
  }

  return parsed.data;
}
