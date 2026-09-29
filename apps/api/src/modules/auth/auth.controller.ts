import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  changePasswordSchema,
  refreshSchema,
  requestOtpSchema,
  staffLoginSchema,
  verifyOtpSchema,
} from '@mk/shared';
import { z } from 'zod';
import { loadConfig } from '../../config/configuration';
import { CurrentActor, Public } from '../../common/auth/decorators';
import { RateLimit } from '../../common/throttle/rate-limit.guard';
import { zodBody } from '../../common/http/zod-validation.pipe';
import type { RequestActor } from '../../common/tenant/tenant-context';
import { AuthService } from './auth.service';

const REFRESH_COOKIE = 'mk_rt';

/**
 * Web clients get the refresh token in an HttpOnly cookie (not readable by JS, so an
 * XSS cannot exfiltrate a long-lived credential). Mobile and POS clients get it in the
 * response body for platform secure storage. Same endpoints, one `client` flag — which
 * is why the future React Native app needs no new auth work.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cfg = loadConfig();

  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ limit: 10, windowSeconds: 60 })
  @Post('staff/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Staff sign in with password (and TOTP if enabled)' })
  async staffLogin(
    @Body(zodBody(staffLoginSchema)) body: z.infer<typeof staffLoginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.staffLogin(body);
    return this.shapeTokens(result, body.client, reply);
  }

  @Public()
  @RateLimit({ limit: 5, windowSeconds: 300 })
  @Post('customer/otp/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a login code to a customer phone' })
  async requestOtp(@Body(zodBody(requestOtpSchema)) body: z.infer<typeof requestOtpSchema>) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @RateLimit({ limit: 15, windowSeconds: 300 })
  @Post('customer/otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body(zodBody(verifyOtpSchema)) body: z.infer<typeof verifyOtpSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.verifyOtp(body);
    return this.shapeTokens(result, 'WEB', reply);
  }

  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60 })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(zodBody(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const fromCookie = this.readCookie(req, REFRESH_COOKIE);
    const result = await this.auth.refresh(body.refreshToken ?? fromCookie ?? '');
    // A refresh that arrived by cookie stays a cookie flow; one that arrived in the
    // body is a native client and gets its token back the same way.
    return this.shapeTokens(result, body.refreshToken ? 'MOBILE' : 'WEB', reply);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = this.readCookie(req, REFRESH_COOKIE);
    void reply.header('set-cookie', `${REFRESH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return this.auth.logout(token);
  }

  @Get('me')
  @ApiOperation({ summary: 'Who am I, and what may I do' })
  async me() {
    return this.auth.me();
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(
    @Body(zodBody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @CurrentActor() actor: RequestActor,
  ) {
    return this.auth.changePassword(actor.userId, body.currentPassword, body.newPassword);
  }

  @Post('totp/setup')
  @HttpCode(200)
  async setupTotp(@CurrentActor() actor: RequestActor) {
    return this.auth.setupTotp(actor.userId);
  }

  @Post('totp/enable')
  @HttpCode(200)
  async enableTotp(
    @Body(zodBody(z.object({ code: z.string().length(6) }))) body: { code: string },
    @CurrentActor() actor: RequestActor,
  ) {
    return this.auth.enableTotp(actor.userId, body.code);
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private shapeTokens<T extends { accessToken: string; refreshToken: string; expiresIn: number }>(
    result: T,
    client: 'WEB' | 'POS' | 'MOBILE',
    reply: FastifyReply,
  ): Omit<T, 'refreshToken'> & { refreshToken?: string } {
    const { refreshToken, ...rest } = result;
    if (client === 'WEB') {
      const parts = [
        `${REFRESH_COOKIE}=${refreshToken}`,
        'Path=/',
        `Max-Age=${this.cfg.JWT_REFRESH_TTL_DAYS * 86_400}`,
        'HttpOnly',
        'SameSite=Lax',
      ];
      if (this.cfg.isProd) parts.push('Secure');
      void reply.header('set-cookie', parts.join('; '));
      return rest;
    }
    return { ...rest, refreshToken };
  }

  private readCookie(req: FastifyRequest, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return v.join('=');
    }
    return undefined;
  }
}
