/**
 * The payment gateway is behind a port, not called directly.
 *
 * Razorpay is the launch choice (best UPI support and documentation in India, and UPI
 * is free up to ₹2,000 per transaction), but gateway economics in India change, and
 * switching to Cashfree or PhonePe should be one adapter rather than a refactor of the
 * order flow.
 */
export interface GatewayOrder {
  gatewayOrderId: string;
  amountMinor: number;
  currency: string;
  /** Public key the browser checkout needs. Never the secret. */
  publicKey: string;
}

export interface VerifiedPayment {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amountMinor: number;
  status: 'PAID' | 'FAILED' | 'PENDING';
  method?: string;
  /** The UPI UTR, when the gateway gives us one. */
  reference?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly enabled: boolean;
  createOrder(args: { amountMinor: number; receipt: string; notes?: Record<string, string> }): Promise<GatewayOrder>;
  /** HMAC verification of a webhook body. Must be constant-time. */
  verifyWebhook(rawBody: string, signature: string): boolean;
  parseWebhook(body: unknown): VerifiedPayment | null;
  refund(gatewayPaymentId: string, amountMinor: number, reason: string): Promise<{ refundId: string }>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
