import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const booleanFromEnv = z
  .preprocess((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '') {
        return undefined;
      }
      if (['true', '1', 'yes', 'y'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'n'].includes(normalized)) {
        return false;
      }
      return value;
    }
    return value;
  }, z.boolean().default(true));

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  SERVER_URL: z
    .string()
    .url({ message: 'SERVER_URL must be a valid URL' })
    .default('http://localhost:4000'),
  DATABASE_URL: z
    .string()
    .min(1, { message: 'DATABASE_URL is required' })
    .default('file:./dev.db'),
  JWT_SECRET: z
    .string()
    .min(1, { message: 'JWT_SECRET is required' })
    .default('REPLACE_ME'),
  ACCESS_TOKEN_TTL_MIN: z.coerce
    .number()
    .int({ message: 'ACCESS_TOKEN_TTL_MIN must be an integer' })
    .positive({ message: 'ACCESS_TOKEN_TTL_MIN must be positive' })
    .default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce
    .number()
    .int({ message: 'REFRESH_TOKEN_TTL_DAYS must be an integer' })
    .positive({ message: 'REFRESH_TOKEN_TTL_DAYS must be positive' })
    .default(30),
  ADMIN_IMPLICIT_ACCESS: booleanFromEnv,
  // Comma-separated list of emails to grant admin on login
  ADMIN_EMAILS: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default('')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.errors
    .map((issue) => {
      const path = issue.path.join('.') || 'root';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
