import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadConfig } from '../../config/configuration';
import type { AccessTokenClaims } from './auth.types';

/**
 * Access tokens are RS256 when a keypair is configured, HS256 otherwise.
 *
 * RS256 matters because the token is verified in more than one place over time
 * (API now, possibly an edge gateway or a second service later) and those verifiers
 * should hold only a public key. The HS256 fallback exists so `npm run dev` works
 * without an openssl step; production refuses to start without a real keypair.
 */
@Injectable()
export class TokenService {
  private readonly cfg = loadConfig();
  private readonly jwt: JwtService;
  private readonly algorithm: 'RS256' | 'HS256';

  constructor() {
    const usingRsa = !!this.cfg.jwtPrivateKey && !!this.cfg.jwtPublicKey;
    this.algorithm = usingRsa ? 'RS256' : 'HS256';
    this.jwt = new JwtService(
      usingRsa
        ? {
            privateKey: this.cfg.jwtPrivateKey,
            publicKey: this.cfg.jwtPublicKey,
            signOptions: {
              algorithm: 'RS256',
              expiresIn: this.cfg.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`,
              issuer: 'mithilakitchen',
            },
            verifyOptions: { algorithms: ['RS256'], issuer: 'mithilakitchen' },
          }
        : {
            secret: this.cfg.MASTER_ENCRYPTION_KEY,
            signOptions: {
              algorithm: 'HS256',
              expiresIn: this.cfg.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`,
              issuer: 'mithilakitchen',
            },
            verifyOptions: { algorithms: ['HS256'], issuer: 'mithilakitchen' },
          },
    );
  }

  get usingAsymmetricKeys(): boolean {
    return this.algorithm === 'RS256';
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims as unknown as Record<string, unknown>);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }

  accessTtlSeconds(): number {
    const ttl = this.cfg.JWT_ACCESS_TTL;
    const m = /^(\d+)([smhd])$/.exec(ttl);
    if (!m) return 900;
    const n = Number(m[1]);
    return n * { s: 1, m: 60, h: 3600, d: 86_400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  }
}
