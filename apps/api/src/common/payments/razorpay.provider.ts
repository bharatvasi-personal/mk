import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../config/configuration';
import type { GatewayOrder, PaymentProvider, VerifiedPayment } from './payment-provider';

/**
 * Razorpay, called over plain `fetch` rather than through their SDK.
 *
 * Three endpoints are all we need, the SDK adds a dependency with its own transitive
 * tree, and the failure modes of `fetch` are ones we already handle. Keeping it thin
 * also makes the Cashfree adapter obviously parallel when it is written.
 *
 * **We never see a card number.** The browser talks to Razorpay Checkout directly;
 * we only ever handle an order id, a payment id and a signature. That keeps the
 * business at PCI-DSS SAQ-A, which is the cheapest compliance posture available.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly cfg = loadConfig();
  private readonly base = 'https://api.razorpay.com/v1';

  get enabled(): boolean {
    return (
      this.cfg.PAYMENTS_ONLINE_ENABLED &&
      !!this.cfg.RAZORPAY_KEY_ID &&
      !!this.cfg.RAZORPAY_KEY_SECRET
    );
  }

  private authHeader(): string {
    const raw = `${this.cfg.RAZORPAY_KEY_ID}:${this.cfg.RAZORPAY_KEY_SECRET}`;
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }

  async createOrder(args: {
    amountMinor: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder> {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Online payment is not switched on. Place the order and pay at the counter.',
      );
    }
    const res = await fetch(`${this.base}/orders`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: args.amountMinor, // Razorpay also works in paise — no conversion needed
        currency: 'INR',
        receipt: args.receipt,
        notes: args.notes,
        payment_capture: 1,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Razorpay order creation failed (${res.status}): ${text}`);
      throw new ServiceUnavailableException('Could not start the payment. Please try again.');
    }
    const body = (await res.json()) as { id: string; amount: number; currency: string };
    return {
      gatewayOrderId: body.id,
      amountMinor: body.amount,
      currency: body.currency,
      publicKey: this.cfg.RAZORPAY_KEY_ID!,
    };
  }

  /**
   * Webhook signature verification. This is the security boundary of the whole online
   * payment flow: without it, anyone who can POST to the webhook URL can mark any
   * order paid. Hence the config validator refuses to start with online payments
   * enabled and no webhook secret.
   */
  verifyWebhook(rawBody: string, signature: string): boolean {
    const secret = this.cfg.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): VerifiedPayment | null {
    const event = body as {
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };
    const payment = event.payload?.payment?.entity;
    if (!payment) return null;

    const status =
      event.event === 'payment.captured' || payment['status'] === 'captured'
        ? 'PAID'
        : event.event === 'payment.failed'
          ? 'FAILED'
          : 'PENDING';

    return {
      gatewayOrderId: String(payment['order_id'] ?? ''),
      gatewayPaymentId: String(payment['id'] ?? ''),
      amountMinor: Number(payment['amount'] ?? 0),
      status,
      method: payment['method'] ? String(payment['method']) : undefined,
      reference:
        (payment['acquirer_data'] as { rrn?: string; upi_transaction_id?: string } | undefined)?.rrn ??
        (payment['acquirer_data'] as { upi_transaction_id?: string } | undefined)?.upi_transaction_id,
    };
  }

  async refund(gatewayPaymentId: string, amountMinor: number, reason: string) {
    const res = await fetch(`${this.base}/payments/${gatewayPaymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountMinor, notes: { reason } }),
    });
    if (!res.ok) throw new ServiceUnavailableException('Refund could not be started');
    const body = (await res.json()) as { id: string };
    return { refundId: body.id };
  }
}
