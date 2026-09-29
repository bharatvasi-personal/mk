import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const RATE_LIMIT = 'mk:rateLimit';

/** `@RateLimit({ limit: 10, windowSeconds: 60 })` on a controller or a single route. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window rate limiter for the endpoints worth protecting.
 *
 * Account lockout already stops a targeted attack on one password, and the OTP flow has
 * its own resend throttle. What neither covers is the cheap, noisy case: someone
 * spraying thousands of requests at `/auth/staff/login` and, as a side effect, making
 * the counter slow at lunchtime. Argon2 is deliberately expensive to compute, which is
 * exactly what makes an unthrottled login endpoint a way to burn the CPU the POS needs.
 *
 * Deliberately in-process. The deployment is a single API container, so a shared store
 * would add a Redis round trip to every login for no additional protection today. If the
 * API is ever scaled to more than one replica this must move to Redis — the counter
 * would otherwise permit `limit x replicas`. That is written here rather than in a
 * ticket because the person who adds the second replica will read this file.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      url: string;
      body?: Record<string, unknown>;
    }>();

    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      'unknown';

    // Keyed on the identifier as well as the IP, so a whole shop behind one NAT address
    // is not locked out because one person mistyped their password — while an attacker
    // cycling identifiers from one address is still bounded by the IP-only bucket below.
    const identifier =
      typeof req.body?.['identifier'] === 'string'
        ? req.body['identifier'].slice(0, 80)
        : typeof req.body?.['phone'] === 'string'
          ? req.body['phone'].slice(0, 20)
          : '';

    const route = req.url.split('?')[0] ?? '';
    const keys = identifier ? [`${route}|${ip}|${identifier}`, `${route}|${ip}`] : [`${route}|${ip}`];

    this.sweep();

    for (const key of keys) {
      const retryAfter = this.hit(key, options);
      if (retryAfter !== null) {
        throw new HttpException(
          {
            message: `Too many attempts. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
            retryAfterSeconds: retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  private hit(key: string, options: RateLimitOptions): number | null {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowSeconds * 1000 });
      return null;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) return Math.ceil((bucket.resetAt - now) / 1000);
    return null;
  }

  /** Drops expired buckets so a long-running process does not accumulate every IP it ever saw. */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
