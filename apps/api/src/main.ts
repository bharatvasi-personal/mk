import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';

/**
 * Postgres counts and sums arrive from `$queryRaw` as BigInt, and `JSON.stringify` throws
 * on one outright — which surfaced as a bare 500 "Something went wrong" on the vendor
 * balances endpoint, with the cause only visible in the server log. Sixteen raw queries in
 * this codebase can return one, so the serialiser is taught the rule once rather than each
 * of them remembering to cast.
 *
 * Emitted as a Number, not a string: every BigInt here is paise or a row count, and Number
 * holds paise exactly to about ₹90,000 crore.
 */
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function toJSON(this: bigint) {
  return Number(this);
};

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const logger = new Logger('Bootstrap');

  const adapter = new FastifyAdapter({
    trustProxy: true, // Caddy sits in front and sets X-Forwarded-For
    bodyLimit: 2 * 1024 * 1024,
    genReqId: (req: { headers: Record<string, unknown> }) =>
      (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    // The payment webhook signature is an HMAC over the *exact* bytes the gateway sent,
    // so the unparsed body has to survive JSON parsing. Nest's own flag does this
    // correctly; replacing Fastify's JSON parser by hand collides with the one Nest
    // installs.
    rawBody: true,
  });

  app.setGlobalPrefix('api');
  // No global ValidationPipe: every endpoint validates with its Zod schema from
  // @mk/shared, which is the same object the web forms use. Adding class-validator
  // alongside it would mean two schemas per endpoint and two chances to disagree.

  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true, // the web client's refresh token is an HttpOnly cookie
    // Spelled out because the default is GET,HEAD,POST — which silently made every PUT
    // and PATCH endpoint unreachable from a browser. The requests never left the page, so
    // editing a vendor, a menu price, an employee or marking a ticket ready simply did
    // nothing, with no error in the server log to find. Curl worked, which is what made it
    // hard to see.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant', 'Idempotency-Key', 'X-Request-Id'],
  });

  if (!cfg.isProd) {
    const doc = new DocumentBuilder()
      .setTitle('MithilaKitchen API')
      .setDescription(
        'The backend for MithilaKitchen. This is the *only* interface to the data — the ' +
          'website, the POS and the future mobile app are all clients of it.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .addGlobalParameters({
        name: 'X-Tenant',
        in: 'header',
        required: false,
        schema: { type: 'string', default: 'mithilakitchen' },
      })
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
    logger.log('API docs at /api/docs');
  }

  if (!new (await import('./common/auth/token.service')).TokenService().usingAsymmetricKeys) {
    logger.warn(
      'JWTs are signed with HS256 from MASTER_ENCRYPTION_KEY. Fine for development; ' +
        'generate an RSA keypair before production (see .env.example).',
    );
  }

  await app.listen(cfg.API_PORT, '0.0.0.0');
  logger.log(`MithilaKitchen API listening on ${cfg.API_PORT} (${cfg.NODE_ENV})`);
  logger.log(
    cfg.PAYMENTS_ONLINE_ENABLED
      ? 'Online payments: ENABLED'
      : 'Online payments: disabled — customers order online and pay at the counter',
  );
}

void bootstrap();
