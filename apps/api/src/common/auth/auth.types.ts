import type { Role } from '@mk/shared';

export interface AccessTokenClaims {
  /** user id (staff) or customer id */
  sub: string;
  tid: string;
  kind: 'STAFF' | 'CUSTOMER' | 'DEVICE';
  name: string;
  grants?: { role: Role; branchId: string | null }[];
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
