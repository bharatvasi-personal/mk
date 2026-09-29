import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '../../config/configuration';
import { TenantDb, type Tx } from '../prisma/tenant-db.service';
import { TenantContext } from '../tenant/tenant-context';

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

export interface OutboundMessage {
  channel: Channel;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  scheduledFor?: Date;
}

/**
 * Everything outbound goes into `notification_outbox` first and is delivered by the
 * worker. Two reasons: a licence-renewal reminder that fails must be retried rather
 * than lost, and a settle transaction must never be held open waiting on an SMS API.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly cfg = loadConfig();

  constructor(private readonly db: TenantDb) {}

  async enqueue(message: OutboundMessage, tx?: Tx): Promise<void> {
    const tenantId = TenantContext.peek()?.tenantId;
    if (!tenantId) throw new Error('Cannot enqueue a notification with no tenant context');

    const data = {
      tenantId,
      channel: message.channel,
      recipient: message.recipient,
      template: message.template,
      payload: message.payload as never,
      scheduledFor: message.scheduledFor ?? new Date(),
    };

    if (tx) {
      await tx.notificationOutbox.create({ data });
    } else {
      await this.db.run((t) => t.notificationOutbox.create({ data }));
    }
  }

  /**
   * OTP delivery is the one case that cannot be queued — the customer is staring at
   * the screen. In development, and whenever MSG91 is unconfigured, the code is
   * logged instead of sent so the flow is testable without an SMS bill.
   */
  async sendOtpNow(phone: string, code: string): Promise<{ delivered: boolean; devCode?: string }> {
    if (!this.cfg.MSG91_AUTH_KEY) {
      this.logger.warn(`[dev] OTP for ${phone} is ${code} (MSG91 not configured, nothing sent)`);
      return { delivered: false, devCode: this.cfg.isProd ? undefined : code };
    }
    try {
      const res = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: this.cfg.MSG91_AUTH_KEY },
        body: JSON.stringify({
          template_id: this.cfg.MSG91_OTP_TEMPLATE_ID,
          mobile: `91${phone.replace(/^\+?91/, '')}`,
          otp: code,
        }),
      });
      if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
      return { delivered: true };
    } catch (err) {
      this.logger.error(`OTP delivery failed for ${phone}: ${(err as Error).message}`);
      return { delivered: false };
    }
  }
}
