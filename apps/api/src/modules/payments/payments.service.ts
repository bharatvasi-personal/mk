import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../common/payments/payment-provider';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { currentTenant } from '../menu/menu.service';
import { RecipeService } from '../inventory/recipe.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly recipes: RecipeService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  get onlineEnabled(): boolean {
    return this.provider.enabled;
  }

  /** Starts a gateway order for an online pickup order. */
  async createIntent(orderId: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, tokenNo: true, totalMinor: true, paymentStatus: true, branchId: true },
      });
      if (order.paymentStatus === 'PAID') throw new BadRequestException('This order is already paid');

      const gateway = await this.provider.createOrder({
        amountMinor: order.totalMinor,
        receipt: `MK-${order.tokenNo}-${order.id.slice(0, 8)}`,
        notes: { orderId: order.id, branchId: order.branchId },
      });

      // Recorded as PENDING now so a webhook has a row to find. It only becomes PAID
      // when the signed webhook says so — never on the browser's word.
      await tx.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          tender: 'UPI_GATEWAY',
          amountMinor: order.totalMinor,
          status: 'UNPAID',
          gatewayProvider: this.provider.name,
          gatewayOrderId: gateway.gatewayOrderId,
        },
      });

      return {
        gatewayOrderId: gateway.gatewayOrderId,
        amountMinor: gateway.amountMinor,
        currency: gateway.currency,
        publicKey: gateway.publicKey,
        orderId: order.id,
        tokenNo: order.tokenNo,
      };
    });
  }

  /**
   * The webhook is the *only* thing that marks an online order paid.
   *
   * The browser callback is advisory — it can be forged, or the customer can close the
   * tab before it fires. The signed server-to-server webhook is the source of truth,
   * and it is idempotent because `(gatewayProvider, gatewayPaymentId)` is unique.
   */
  async handleWebhook(rawBody: string, signature: string): Promise<{ handled: boolean }> {
    if (!this.provider.verifyWebhook(rawBody, signature)) {
      this.logger.warn('Rejected a payment webhook with an invalid signature');
      throw new BadRequestException('Invalid signature');
    }

    const parsed = this.provider.parseWebhook(JSON.parse(rawBody));
    if (!parsed || !parsed.gatewayOrderId) return { handled: false };

    // The gateway knows nothing about tenants, so the tenant is resolved from the
    // gateway order id through a narrow SECURITY DEFINER function before anything is
    // read — see prisma/sql/02_rls.sql.
    const resolved = await this.db.runWithoutTenantScope('resolve tenant from a gateway order', (tx) =>
      tx.$queryRaw<{ id: string | null }[]>`
        SELECT public.resolve_tenant_by_gateway_order(${this.provider.name}, ${parsed.gatewayOrderId}) AS id
      `,
    );
    const tenantId = resolved[0]?.id;
    if (!tenantId) {
      this.logger.warn(`Webhook for unknown gateway order ${parsed.gatewayOrderId}`);
      return { handled: false };
    }

    return this.db.run(async (tx) => {
      const pending = await tx.payment.findFirst({
        where: { gatewayOrderId: parsed.gatewayOrderId, gatewayProvider: this.provider.name },
        include: { order: true },
      });
      if (!pending) return { handled: false };

      if (pending.status === 'PAID') return { handled: true };

      if (parsed.status === 'FAILED') {
        await tx.payment.update({
          where: { id: pending.id },
          data: { status: 'FAILED', gatewayPayload: JSON.parse(rawBody) },
        });
        await tx.order.update({
          where: { id: pending.orderId },
          data: { paymentStatus: 'FAILED' },
        });
        return { handled: true };
      }

      if (parsed.status !== 'PAID') return { handled: true };

      // Amount check: a webhook claiming a smaller amount than the bill must not settle it.
      if (parsed.amountMinor !== pending.amountMinor) {
        this.logger.error(
          `Webhook amount ${parsed.amountMinor} does not match payment ${pending.amountMinor} ` +
            `for order ${pending.orderId} — not settling`,
        );
        return { handled: false };
      }

      await tx.payment.update({
        where: { id: pending.id },
        data: {
          status: 'PAID',
          gatewayPaymentId: parsed.gatewayPaymentId,
          reference: parsed.reference,
          gatewayPayload: JSON.parse(rawBody),
          receivedAt: new Date(),
        },
      });

      // An online order is confirmed to the kitchen only once the money has landed.
      await this.recipes.consumeForOrder(tx, pending.orderId).catch((err) => {
        // Never lose a confirmed payment because a recipe is missing. Log it, settle
        // the money, and let the variance report surface the un-costed item.
        this.logger.error(`Stock depletion failed for order ${pending.orderId}: ${err.message}`);
        return { costMinor: 0, lines: [] };
      });

      await tx.order.update({
        where: { id: pending.orderId },
        data: {
          paymentStatus: 'PAID',
          paidMinor: pending.amountMinor,
          status: 'CONFIRMED',
        },
      });

      await this.audit.log(tx, {
        action: 'ONLINE_PAYMENT_RECEIVED',
        entity: 'Order',
        entityId: pending.orderId,
        branchId: pending.order.branchId,
        after: {
          amountMinor: parsed.amountMinor,
          gatewayPaymentId: parsed.gatewayPaymentId,
          method: parsed.method,
        },
      });

      return { handled: true };
    }, { tenantId });
  }
}
