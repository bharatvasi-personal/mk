import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Two endpoints, because they answer different questions.
 *
 * `/health/live` — is the process up? If this fails, restart the container.
 * `/health/ready` — can it serve traffic? If this fails, take it out of rotation but do
 * not restart: the database being briefly unreachable is not fixed by killing the app.
 *
 * Uptime Kuma polls `/health/ready` every 60 seconds and alerts the partners on Telegram.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', latencyMs: Date.now() - started };
    } catch (err) {
      return { status: 'degraded', database: 'down', error: (err as Error).message };
    }
  }
}
