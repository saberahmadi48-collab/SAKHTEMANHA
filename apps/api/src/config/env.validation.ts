import { z } from 'zod';

/**
 * Boot-time environment validation.
 *
 * The API refuses to start on an invalid config rather than failing later at
 * the first request. Note the production-only secret-strength checks: a default
 * or shared JWT secret is a total authentication bypass, so it is treated as a
 * startup error, never a warning.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    API_GLOBAL_PREFIX: z.string().default('api'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('900s'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_TTL: z.string().default('30d'),
    PASSWORD_HASH_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    REDIS_URL: z.string().url().optional(),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

    INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
    APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // In production the two secrets must differ: reusing one secret for both
    // token types lets a stolen refresh token be replayed as an access token.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT access and refresh secrets must differ in production',
      });
    }
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].includes('replace-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still holds the placeholder value from .env.example`,
        });
      }
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER is "s3"',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Names the offending KEYS only — never their values, which would print
    // secrets into logs and crash dumps.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
