import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Configuration is validated at boot and the process refuses to start if anything
 * is missing or malformed.
 *
 * A misconfigured production should crash loudly, not fall back to a development
 * default. The class of bug this prevents — production quietly running with a
 * dev JWT key, or with payments pointed at a test account — is expensive.
 */
const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(def)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TZ: z.string().default('Asia/Kolkata'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    API_PORT: z.coerce.number().int().default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    JWT_PRIVATE_KEY_PATH: z.string().optional(),
    JWT_PUBLIC_KEY_PATH: z.string().optional(),
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
    MASTER_ENCRYPTION_KEY: z.string().min(16),

    PAYMENTS_ONLINE_ENABLED: bool(false),
    PAYMENT_PROVIDER: z.enum(['razorpay', 'cashfree', 'none']).default('razorpay'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('mithilakitchen'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(true),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('MithilaKitchen <no-reply@mithilakitchen.in>'),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_SENDER_ID: z.string().default('MTHLKT'),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production-only invariants. Each of these has a plausible failure story.
    if (env.MASTER_ENCRYPTION_KEY.startsWith('CHANGE_ME')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MASTER_ENCRYPTION_KEY is still the example value',
      });
    }
    if (!env.JWT_PRIVATE_KEY && !env.JWT_PRIVATE_KEY_PATH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A JWT signing key is required' });
    }
    if (env.PAYMENTS_ONLINE_ENABLED) {
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'PAYMENTS_ONLINE_ENABLED is true but Razorpay credentials are missing',
        });
      }
      if (!env.RAZORPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'RAZORPAY_WEBHOOK_SECRET is required — without it a webhook signature cannot be verified, ' +
            'and an unverified webhook can mark any order paid',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function readKey(inline?: string, path?: string): string | undefined {
  if (inline && inline.trim()) return inline.replace(/\\n/g, '\n');
  if (path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface AppConfig extends Env {
  corsOrigins: string[];
  jwtPrivateKey?: string;
  jwtPublicKey?: string;
  isProd: boolean;
}

let cached: AppConfig | undefined;

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    // Deliberately a hard exit rather than a thrown error: a half-configured API
    // that starts is worse than one that does not.
    // eslint-disable-next-line no-console
    console.error(`\nInvalid configuration:\n${lines.join('\n')}\n`);
    process.exit(1);
  }
  const env = parsed.data;
  cached = {
    ...env,
    isProd: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwtPrivateKey: readKey(env.JWT_PRIVATE_KEY, env.JWT_PRIVATE_KEY_PATH),
    jwtPublicKey: readKey(env.JWT_PUBLIC_KEY, env.JWT_PUBLIC_KEY_PATH),
  };
  return cached;
}

export const CONFIG = 'APP_CONFIG';
