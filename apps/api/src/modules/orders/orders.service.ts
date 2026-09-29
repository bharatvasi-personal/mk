import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateOrderInput, QuickBillInput, SettleOrderInput } from '@mk/shared';
import type { KitchenStation, OrderStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { TenantDb, type Tx } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { RecipeService } from '../inventory/recipe.service';
import { currentTenant } from '../menu/menu.service';
import { financialYear, priceOrder, type PricedLine } from './pricing';

/** Which kitchen station prepares a category. The Chinese counter gets its own tickets. */
function stationFor(categorySlug: string, itemName: string): KitchenStation {
  const s = `${categorySlug} ${itemName}`.toLowerCase();
  if (/chinese|noodle|manchur|fried rice|chilli|momo/.test(s)) return 'CHINESE';
  if (/chai|tea|coffee|lassi|juice|shake/.test(s)) return 'CHAI';
  if (/tandoor|roti|naan|kulcha/.test(s)) return 'TANDOOR';
  return 'MAIN';
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly recipes: RecipeService,
  ) {}

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Creates an order and prices it from the branch menu.
   *
   * Prices are never taken from the client. The POS sends variant ids and quantities;
   * the server looks up the price. A client that can name its own price is a client
   * that will eventually be used to name its own price.
   *
   * `clientRef` is a POS-generated UUID with a unique constraint behind it, so a retry
   * from the offline queue returns the original order rather than creating a second one.
   */
  async create(input: CreateOrderInput, opts: { allowDiscount: boolean }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const actor = TenantContext.actor();

      const existing = await tx.order.findUnique({
        where: { branchId_clientRef: { branchId: input.branchId, clientRef: input.clientRef } },
        include: { items: true },
      });
      if (existing) return existing;

      if (input.discountMinor > 0 && !opts.allowDiscount) {
        throw new ForbiddenException('You do not have permission to apply a discount');
      }

      const priced = await this.priceFromMenu(tx, input);

      // Token numbers restart each day per branch — "token 15" must mean today's 15.
      const tokenNo = await this.nextTokenNo(tx, input.branchId);

      const openSession = await tx.cashSession.findFirst({
        where: { branchId: input.branchId, closedAt: null },
        orderBy: { openedAt: 'desc' },
        select: { id: true },
      });

      const order = await tx.order.create({
        data: {
          tenantId,
          branchId: input.branchId,
          tokenNo,
          clientRef: input.clientRef,
          channel: input.channel,
          mealSlot: input.mealSlot,
          status: 'PLACED',
          tableId: input.tableId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          guestCount: input.guestCount,
          pickupAt: input.pickupAt ? new Date(input.pickupAt) : null,
          notes: input.notes,
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          taxMinor: priced.taxMinor,
          roundOffMinor: priced.roundOffMinor,
          totalMinor: priced.totalMinor,
          placedAt: new Date(),
          createdByUserId: actor?.kind === 'STAFF' ? actor.userId : null,
          cashSessionId: openSession?.id,
          items: {
            create: priced.lines.map((l) => ({
              tenantId,
              menuItemId: l.menuItemId,
              variantId: l.variantId,
              nameSnapshot: l.nameSnapshot,
              variantSnapshot: l.variantSnapshot,
              qty: l.qty,
              unitPriceMinor: l.unitPriceMinor,
              gstRateBp: l.gstRateBp,
              lineSubtotalMinor: l.lineSubtotalMinor,
              lineDiscountMinor: l.lineDiscountMinor,
              lineTaxMinor: l.lineTaxMinor,
              lineTotalMinor: l.lineTotalMinor,
              notes: l.notes,
            })),
          },
          statusEvents: {
            create: { tenantId, toStatus: 'PLACED', byUserId: actor?.userId },
          },
        },
        include: { items: true },
      });

      if (input.discountMinor > 0) {
        await this.audit.log(tx, {
          action: 'ORDER_DISCOUNT',
          entity: 'Order',
          entityId: order.id,
          branchId: input.branchId,
          after: { discountMinor: input.discountMinor, reason: input.discountReason },
        });
      }

      return order;
    });
  }

  /** Confirms the order and cuts kitchen tickets, split by station. */
  async confirmAndPrintKot(orderId: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: {
            where: { isVoided: false },
            include: { menuItem: { select: { name: true, category: { select: { slug: true } } } } },
          },
          kitchenTickets: true,
        },
      });
      if (order.status === 'SETTLED' || order.status === 'CANCELLED') {
        throw new BadRequestException('This order is closed');
      }
      if (order.kitchenTickets.length > 0) {
        // Already sent. Reprinting is a separate, audited action, not an accident.
        return tx.kitchenTicket.findMany({ where: { orderId }, include: { items: true } });
      }

      const byStation = new Map<KitchenStation, typeof order.items>();
      for (const item of order.items) {
        const station = stationFor(item.menuItem.category.slug, item.menuItem.name);
        byStation.set(station, [...(byStation.get(station) ?? []), item]);
      }

      const tickets = [];
      for (const [station, items] of byStation) {
        const ticketNo = await this.nextTicketNo(tx, order.branchId, station);
        tickets.push(
          await tx.kitchenTicket.create({
            data: {
              tenantId,
              orderId,
              station,
              ticketNo,
              printedAt: new Date(),
              items: {
                create: items.map((i) => ({
                  tenantId,
                  orderItemId: i.id,
                  qty: i.qty,
                  notes: i.notes,
                })),
              },
            },
            include: { items: true },
          }),
        );
      }

      await this.setStatus(tx, orderId, 'CONFIRMED');
      return tickets;
    });
  }

  // ─── Settle ───────────────────────────────────────────────────────────────

  /**
   * Settling a bill is the one transaction that must be all-or-nothing:
   * payments recorded, stock depleted, cost of goods captured, a gapless GST invoice
   * number allocated, and the order frozen. If any part fails, none of it happened.
   *
   * The invoice number is allocated with SELECT ... FOR UPDATE on a counter row rather
   * than from a Postgres sequence, because a sequence leaks numbers on rollback and a
   * GST auditor will ask about the gap.
   */
  async settle(input: SettleOrderInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const actor = TenantContext.actor();

      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: { items: { where: { isVoided: false } }, payments: true, branch: true },
      });

      if (order.status === 'SETTLED') {
        throw new ConflictException('This bill is already settled');
      }
      if (order.status === 'CANCELLED') {
        throw new BadRequestException('This order was cancelled');
      }
      if (order.items.length === 0) {
        throw new BadRequestException('Cannot settle an order with no items');
      }

      const tendered = input.tenders.reduce((s, t) => s + t.amountMinor, 0);
      if (tendered < order.totalMinor) {
        throw new BadRequestException(
          `Short by ₹${((order.totalMinor - tendered) / 100).toFixed(2)} — tenders must cover the bill`,
        );
      }

      // Change is only meaningful for cash. An overpayment on UPI is a data-entry error,
      // not a tip, so it is rejected rather than silently absorbed.
      const cashTender = input.tenders.find((t) => t.tender === 'CASH');
      const overpaid = tendered - order.totalMinor;
      if (overpaid > 0 && !cashTender) {
        throw new BadRequestException('Tenders exceed the bill total — check the amounts');
      }

      for (const t of input.tenders) {
        await tx.payment.create({
          data: {
            tenantId,
            orderId: order.id,
            tender: t.tender,
            amountMinor: t.amountMinor,
            tenderedMinor: t.tenderedMinor ?? (t.tender === 'CASH' ? t.amountMinor : null),
            changeMinor: t.tender === 'CASH' ? overpaid : null,
            reference: t.reference,
            status: 'PAID',
            receivedByUserId: actor?.userId,
          },
        });
      }

      // Stock depletion and COGS. Inside the transaction on purpose: a bill without its
      // consumption corrupts both the stock position and the food-cost figure, and the
      // corruption stays invisible until someone counts.
      const { costMinor } = await this.recipes.consumeForOrder(tx, order.id);

      const invoice = await this.issueInvoice(tx, order.id);

      const settled = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'SETTLED',
          paymentStatus: 'PAID',
          paidMinor: order.totalMinor,
          costMinor,
          settledAt: new Date(),
        },
      });

      await tx.orderStatusEvent.create({
        data: { tenantId, orderId: order.id, fromStatus: order.status, toStatus: 'SETTLED', byUserId: actor?.userId },
      });

      await this.audit.log(tx, {
        action: 'ORDER_SETTLED',
        entity: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        after: {
          invoiceNo: invoice.invoiceNo,
          totalMinor: order.totalMinor,
          costMinor,
          tenders: input.tenders.map((t) => ({ tender: t.tender, amountMinor: t.amountMinor })),
        },
      });

      return {
        order: settled,
        invoice,
        changeMinor: overpaid,
        bill: await this.billPayload(tx, order.id),
      };
    });
  }

  /**
   * Gapless per-branch, per-financial-year invoice number.
   * The row lock serialises concurrent settles at the same branch — which is exactly
   * what two tablets at one counter will do at 1:15 pm.
   */
  private async issueInvoice(tx: Tx, orderId: string) {
    const tenantId = await currentTenant(tx);
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { where: { isVoided: false } },
        branch: { select: { id: true, code: true, name: true, gstin: true, addressLine1: true, city: true, state: true, pincode: true, phone: true } },
      },
    });
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const now = new Date();
    const fy = financialYear(now, tenant.fyStartMonth);

    const invoiceNo = await this.nextDocumentNumber(tx, order.branchId, order.branch.code, fy, 'INV');

    // Menu prices are GST-inclusive, so the tax already extracted on each line is split
    // half CGST / half SGST. IGST does not arise — a restaurant serves where it stands.
    const cgst = Math.round(order.taxMinor / 2);
    const sgst = order.taxMinor - cgst;

    const taxBreakup = Object.values(
      order.items.reduce<Record<string, { rateBp: number; taxableMinor: number; taxMinor: number }>>(
        (acc, item) => {
          const key = String(item.gstRateBp);
          const bucket = acc[key] ?? { rateBp: item.gstRateBp, taxableMinor: 0, taxMinor: 0 };
          bucket.taxableMinor += item.lineTotalMinor - item.lineTaxMinor;
          bucket.taxMinor += item.lineTaxMinor;
          acc[key] = bucket;
          return acc;
        },
        {},
      ),
    );

    return tx.invoice.create({
      data: {
        tenantId,
        orderId,
        invoiceNo,
        fy,
        sellerSnapshot: {
          legalName: tenant.legalName ?? tenant.name,
          tradeName: tenant.name,
          gstin: order.branch.gstin ?? tenant.gstin,
          fssaiNo: tenant.fssaiNo,
          pan: tenant.pan,
          branch: order.branch.name,
          address: [order.branch.addressLine1, order.branch.city, order.branch.state, order.branch.pincode]
            .filter(Boolean)
            .join(', '),
          phone: order.branch.phone,
        } as Prisma.InputJsonValue,
        buyerName: order.customerName,
        buyerPhone: order.customerPhone,
        subtotalMinor: order.subtotalMinor,
        discountMinor: order.discountMinor,
        cgstMinor: cgst,
        sgstMinor: sgst,
        roundOffMinor: order.roundOffMinor,
        totalMinor: order.totalMinor,
        taxBreakup: taxBreakup as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Create, optionally cut a KOT, and settle — all in one transaction.
   *
   * This is what the POS calls for the common case, where the customer orders and pays
   * at the same moment. One round trip instead of three, and one idempotent operation
   * for the offline queue to replay instead of an ordered pair.
   *
   * A replay of the same `clientRef` after the bill already settled returns the existing
   * bill rather than erroring, because from the POS's point of view the retry succeeded.
   */
  async quickBill(input: QuickBillInput, opts: { allowDiscount: boolean }) {
    const existing = await this.db.run((tx) =>
      tx.order.findUnique({
        where: { branchId_clientRef: { branchId: input.branchId, clientRef: input.clientRef } },
        include: { invoice: true },
      }),
    );

    if (existing?.status === 'SETTLED') {
      return {
        order: existing,
        invoice: existing.invoice,
        changeMinor: 0,
        bill: await this.bill(existing.id),
        replayed: true,
      };
    }

    const order = existing ?? (await this.create(input, opts));

    if (input.sendToKitchen) {
      await this.confirmAndPrintKot(order.id).catch(() => {
        // A failed KOT must not block the bill. The kitchen can be told verbally; an
        // unsettled bill cannot be recovered from a queue of banknotes.
      });
    }

    const settled = await this.settle({
      orderId: order.id,
      tenders: input.tenders,
      roundOff: input.roundOff,
      printBill: true,
    });

    return { ...settled, replayed: false };
  }

  /**
   * Allocates the next number in a gapless, per-branch, per-financial-year, per-series run.
   *
   * `SELECT ... FOR UPDATE` on the counter row rather than a Postgres sequence, because a
   * sequence leaks numbers on rollback and GST requires an unbroken run — an auditor will
   * ask about the gap. The row lock serialises concurrent issuers at the same branch,
   * which is exactly what two tablets at one counter do at 1:15 pm.
   *
   * Because the lock is held to the end of the caller's transaction, a rollback releases
   * the number too, and the next caller gets it.
   */
  private async nextDocumentNumber(
    tx: Tx,
    branchId: string,
    branchCode: string,
    fy: string,
    series: 'INV' | 'CN',
  ): Promise<string> {
    const tenantId = await currentTenant(tx);
    const prefix = series === 'INV' ? `${branchCode}/${fy}` : `CN/${branchCode}/${fy}`;

    const row = await tx.invoiceSequence.upsert({
      where: { branchId_fy_series: { branchId, fy, series } },
      create: { tenantId, branchId, fy, series, prefix, lastNumber: 0 },
      update: {},
    });

    const [locked] = await tx.$queryRaw<{ last_number: number }[]>`
      SELECT last_number FROM invoice_sequences WHERE id = ${row.id}::uuid FOR UPDATE
    `;
    const next = (locked?.last_number ?? 0) + 1;
    await tx.invoiceSequence.update({ where: { id: row.id }, data: { lastNumber: next } });

    return `${row.prefix}/${String(next).padStart(5, '0')}`;
  }

  // ─── Voids, cancels, credit notes ─────────────────────────────────────────

  async voidItem(orderId: string, orderItemId: string, reason: string) {
    return this.db.run(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'SETTLED') {
        throw new BadRequestException('A settled bill cannot be edited — issue a credit note instead');
      }
      const item = await tx.orderItem.update({
        where: { id: orderItemId },
        data: { isVoided: true, voidReason: reason },
      });
      await this.reprice(tx, orderId);
      await this.audit.log(tx, {
        action: 'ORDER_ITEM_VOIDED',
        entity: 'OrderItem',
        entityId: orderItemId,
        branchId: order.branchId,
        after: { item: item.nameSnapshot, qty: item.qty, reason },
      });
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    });
  }

  async cancel(orderId: string, reason: string) {
    return this.db.run(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'SETTLED') {
        throw new BadRequestException('A settled bill cannot be cancelled — issue a credit note');
      }
      const cancelled = await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
      await tx.orderStatusEvent.create({
        data: {
          tenantId: order.tenantId,
          orderId,
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          byUserId: TenantContext.actor()?.userId,
          note: reason,
        },
      });
      await this.audit.log(tx, {
        action: 'ORDER_CANCELLED',
        entity: 'Order',
        entityId: orderId,
        branchId: order.branchId,
        after: { reason, totalMinor: order.totalMinor },
      });
      return cancelled;
    });
  }

  /**
   * The only legitimate way to correct a settled bill. The invoice stays untouched —
   * that is what "immutable" means — and the credit note carries the correction.
   */
  async issueCreditNote(orderId: string, amountMinor: number, reason: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { invoice: true, creditNotes: true },
      });
      if (!order.invoice) throw new BadRequestException('This order has no invoice to credit');

      const alreadyCredited = order.creditNotes.reduce((s, c) => s + c.amountMinor, 0);
      if (alreadyCredited + amountMinor > order.invoice.totalMinor) {
        throw new BadRequestException('Credit notes would exceed the invoice total');
      }

      const branch = await tx.branch.findUniqueOrThrow({
        where: { id: order.branchId },
        select: { code: true },
      });
      // The same locked counter as invoices, in its own series. The previous
      // implementation used `count() + 1`, which two concurrent credit notes would
      // resolve to the same number, and which never reset per financial year.
      const noteNo = await this.nextDocumentNumber(
        tx,
        order.branchId,
        branch.code,
        order.invoice.fy,
        'CN',
      );

      const note = await tx.creditNote.create({
        data: {
          tenantId,
          invoiceId: order.invoice.id,
          orderId,
          noteNo,
          reason,
          amountMinor,
          issuedByUserId: TenantContext.actor()?.userId,
        },
      });

      await this.audit.log(tx, {
        action: 'CREDIT_NOTE_ISSUED',
        entity: 'CreditNote',
        entityId: note.id,
        branchId: order.branchId,
        after: { invoiceNo: order.invoice.invoiceNo, amountMinor, reason },
      });
      return note;
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async openOrders(branchId: string) {
    return this.db.run((tx) =>
      tx.order.findMany({
        where: { branchId, status: { in: ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] } },
        include: {
          items: { where: { isVoided: false } },
          table: { select: { label: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async kitchenQueue(branchId: string, station?: KitchenStation) {
    return this.db.run((tx) =>
      tx.kitchenTicket.findMany({
        where: {
          ...(station ? { station } : {}),
          readyAt: null,
          order: { branchId, status: { in: ['CONFIRMED', 'PREPARING'] } },
        },
        include: {
          items: { include: { orderItem: { select: { nameSnapshot: true, variantSnapshot: true, notes: true } } } },
          order: { select: { id: true, tokenNo: true, channel: true, createdAt: true, notes: true, table: { select: { label: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(orderId: string) {
    return this.db.run(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          payments: true,
          invoice: true,
          creditNotes: true,
          statusEvents: { orderBy: { createdAt: 'asc' } },
          table: { select: { label: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      return order;
    });
  }

  /** Everything the thermal printer needs, resolved server-side so the POS just prints. */
  async bill(orderId: string) {
    return this.db.run((tx) => this.billPayload(tx, orderId));
  }

  async updateStatus(orderId: string, status: OrderStatus) {
    return this.db.run((tx) => this.setStatus(tx, orderId, status));
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async billPayload(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { where: { isVoided: false } },
        payments: true,
        invoice: true,
        table: { select: { label: true } },
        branch: { select: { name: true, addressLine1: true, city: true, pincode: true, phone: true, gstin: true } },
      },
    });
    const tenant = await tx.tenant.findFirstOrThrow({ select: { name: true, fssaiNo: true, gstin: true } });
    return {
      tenantName: tenant.name,
      fssaiNo: tenant.fssaiNo,
      gstin: order.branch.gstin ?? tenant.gstin,
      branch: order.branch,
      invoiceNo: order.invoice?.invoiceNo ?? null,
      tokenNo: order.tokenNo,
      channel: order.channel,
      table: order.table?.label ?? null,
      issuedAt: order.invoice?.issuedAt ?? order.createdAt,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      lines: order.items.map((i) => ({
        name: i.nameSnapshot,
        variant: i.variantSnapshot,
        qty: i.qty,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
      })),
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      cgstMinor: order.invoice?.cgstMinor ?? Math.round(order.taxMinor / 2),
      sgstMinor: order.invoice?.sgstMinor ?? order.taxMinor - Math.round(order.taxMinor / 2),
      roundOffMinor: order.roundOffMinor,
      totalMinor: order.totalMinor,
      payments: order.payments.map((p) => ({
        tender: p.tender,
        amountMinor: p.amountMinor,
        reference: p.reference,
      })),
    };
  }

  private async priceFromMenu(tx: Tx, input: CreateOrderInput) {
    const variantIds = input.items.map((i) => i.variantId);
    const rows = await tx.branchMenuItem.findMany({
      where: { branchId: input.branchId, variantId: { in: variantIds }, mealSlot: input.mealSlot },
      include: {
        variant: { select: { id: true, name: true } },
        menuItem: { select: { id: true, name: true } },
      },
    });
    const byVariant = new Map(rows.map((r) => [r.variantId, r]));

    const now = new Date();
    const lines: Omit<PricedLine, 'lineSubtotalMinor' | 'lineDiscountMinor' | 'lineTaxMinor' | 'lineTotalMinor'>[] = [];

    for (const item of input.items) {
      const row = byVariant.get(item.variantId);
      if (!row) {
        throw new BadRequestException(
          `That item is not on the ${input.mealSlot.toLowerCase()} menu at this branch`,
        );
      }
      if (!row.isAvailable) throw new BadRequestException(`${row.menuItem.name} is not available`);
      if (row.soldOutUntil && row.soldOutUntil > now) {
        throw new BadRequestException(`${row.menuItem.name} is sold out`);
      }
      lines.push({
        variantId: row.variantId,
        menuItemId: row.menuItemId,
        nameSnapshot: row.menuItem.name,
        variantSnapshot: row.variant.name,
        qty: item.qty,
        unitPriceMinor: row.priceMinor,
        gstRateBp: row.gstRateBp,
        notes: item.notes,
      });
    }

    return priceOrder(lines, { discountMinor: input.discountMinor });
  }

  /** Recomputes totals after a void. Prices come from the stored line snapshots. */
  private async reprice(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { where: { isVoided: false } } },
    });
    const priced = priceOrder(
      order.items.map((i) => ({
        variantId: i.variantId,
        menuItemId: i.menuItemId,
        nameSnapshot: i.nameSnapshot,
        variantSnapshot: i.variantSnapshot,
        qty: i.qty,
        unitPriceMinor: i.unitPriceMinor,
        gstRateBp: i.gstRateBp,
      })),
      { discountMinor: 0 },
    );
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotalMinor: priced.subtotalMinor,
        taxMinor: priced.taxMinor,
        roundOffMinor: priced.roundOffMinor,
        totalMinor: priced.totalMinor,
        discountMinor: 0,
      },
    });
  }

  private async setStatus(tx: Tx, orderId: string, status: OrderStatus) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === 'SETTLED' || order.status === 'CANCELLED') {
      throw new BadRequestException('This order is closed');
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { status } });
    await tx.orderStatusEvent.create({
      data: {
        tenantId: order.tenantId,
        orderId,
        fromStatus: order.status,
        toStatus: status,
        byUserId: TenantContext.actor()?.userId,
      },
    });
    if (status === 'READY') {
      await tx.kitchenTicket.updateMany({ where: { orderId, readyAt: null }, data: { readyAt: new Date() } });
    }
    return updated;
  }

  /** Per-branch, per-day token counter. Derived from today's orders, so no extra table. */
  private async nextTokenNo(tx: Tx, branchId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(token_no) AS max FROM orders
      WHERE branch_id = ${branchId}::uuid
        AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    `;
    return (rows[0]?.max ?? 0) + 1;
  }

  private async nextTicketNo(tx: Tx, branchId: string, station: KitchenStation): Promise<number> {
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(kt.ticket_no) AS max FROM kitchen_tickets kt
      JOIN orders o ON o.id = kt.order_id
      WHERE o.branch_id = ${branchId}::uuid
        AND kt.station = ${station}::"KitchenStation"
        AND (kt.created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
    `;
    return (rows[0]?.max ?? 0) + 1;
  }
}
