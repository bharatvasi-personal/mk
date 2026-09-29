import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import nodemailer from 'nodemailer';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { TenantDb } from './common/prisma/tenant-db.service';

/**
 * The worker process.
 *
 * Same image as the API, different entrypoint. It runs the scheduled jobs (via the
 * ScheduleModule inside AppModule) and drains the notification outbox, so a slow report
 * rollup or an unresponsive SMS provider cannot make the POS wait at 1:15 pm.
 *
 * Created with `createApplicationContext`, so no HTTP port is opened — the only way in
 * is the database.
 */
async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const db = app.get(TenantDb);

  const mailer =
    cfg.SMTP_HOST && cfg.SMTP_USER
      ? nodemailer.createTransport({
          host: cfg.SMTP_HOST,
          port: cfg.SMTP_PORT,
          secure: cfg.SMTP_PORT === 465,
          auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD },
        })
      : null;

  if (!mailer) {
    logger.warn('SMTP is not configured — outbox messages will be logged, not sent');
  }

  /**
   * Drains the outbox with capped exponential backoff. A message that has failed six
   * times is left in the table rather than deleted, because a licence-renewal reminder
   * that silently gave up is exactly the failure we are trying to prevent.
   */
  async function drainOutbox(): Promise<void> {
    const pending = await db.runWithoutTenantScope('drain the outbox across tenants', (tx) =>
      tx.notificationOutbox.findMany({
        where: { status: 'PENDING', attempts: { lt: 6 }, scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'asc' },
        take: 50,
      }),
    );

    for (const message of pending) {
      try {
        if (message.channel === 'EMAIL' && mailer) {
          const payload = message.payload as Record<string, unknown>;
          await mailer.sendMail({
            from: cfg.SMTP_FROM,
            to: message.recipient,
            subject: subjectFor(message.template, payload),
            text: bodyFor(message.template, payload),
          });
        } else {
          logger.log(
            `[not sent: ${message.channel} unconfigured] ${message.template} -> ${message.recipient}`,
          );
        }
        await db.runWithoutTenantScope('mark outbox message sent', (tx) =>
          tx.notificationOutbox.update({
            where: { id: message.id },
            data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
          }),
        );
      } catch (err) {
        const attempts = message.attempts + 1;
        await db.runWithoutTenantScope('record outbox failure', (tx) =>
          tx.notificationOutbox.update({
            where: { id: message.id },
            data: {
              attempts,
              lastError: (err as Error).message.slice(0, 500),
              // 1, 2, 4, 8, 16, 32 minutes.
              scheduledFor: new Date(Date.now() + 2 ** attempts * 60_000),
              status: attempts >= 6 ? 'FAILED' : 'PENDING',
            },
          }),
        );
        logger.error(`Outbox ${message.id} failed (attempt ${attempts}): ${(err as Error).message}`);
      }
    }
  }

  const interval = setInterval(() => void drainOutbox(), 30_000);
  void drainOutbox();

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received, shutting down`);
    clearInterval(interval);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('Worker running: scheduled jobs active, outbox draining every 30s');
}

function subjectFor(template: string, p: Record<string, unknown>): string {
  switch (template) {
    case 'document-expiring':
      return `[MithilaKitchen] ${p['title']} expires in ${p['daysLeft']} days`;
    case 'document-expired':
      return `[MithilaKitchen] ${p['title']} has EXPIRED`;
    default:
      return `[MithilaKitchen] ${template}`;
  }
}

function bodyFor(template: string, p: Record<string, unknown>): string {
  if (template.startsWith('document-')) {
    return [
      `${p['name'] ?? 'Hello'},`,
      '',
      template === 'document-expired'
        ? `${p['title']} expired on ${p['expiresOn']}.`
        : `${p['title']} expires on ${p['expiresOn']} — ${p['daysLeft']} days from now.`,
      p['documentNumber'] ? `Document number: ${p['documentNumber']}` : '',
      '',
      'Renew it and upload the new certificate to the document vault. The old one is kept',
      'as proof of continuity.',
      '',
      '— MithilaKitchen',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(p, null, 2);
}

void bootstrap();
