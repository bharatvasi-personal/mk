import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** The raw client. Nothing outside this folder should use it directly — use TenantDb. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Fail fast and loudly if the app is connected as a role that can bypass RLS.
    // Tenant isolation is the one invariant we cannot afford to be wrong about.
    try {
      const rows = await this.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
        Prisma.sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      const role = rows[0];
      if (role && (role.rolsuper || role.rolbypassrls)) {
        const message =
          `The database role "${await this.currentUser()}" can bypass row-level security. ` +
          'Tenant isolation is NOT being enforced. Connect as the mk_app role (see infra/compose).';
        if (process.env.NODE_ENV === 'production') throw new Error(message);
        this.logger.warn(message);
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      this.logger.warn(`Could not verify RLS posture: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async currentUser(): Promise<string> {
    const rows = await this.$queryRaw<{ current_user: string }[]>(Prisma.sql`SELECT current_user`);
    return rows[0]?.current_user ?? 'unknown';
  }
}
