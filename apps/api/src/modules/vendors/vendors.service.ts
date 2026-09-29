import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GoodsReceiptInput, PurchaseOrderInput, VendorInput } from '@mk/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { StockService } from '../inventory/stock.service';
import { currentTenant } from '../menu/menu.service';

const D = Prisma.Decimal;

@Injectable()
export class VendorsService {
  constructor(
    private readonly db: TenantDb,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // ─── Directory ────────────────────────────────────────────────────────────

  async list(opts: { search?: string; activeOnly?: boolean } = {}) {
    return this.db.run((tx) =>
      tx.vendor.findMany({
        where: {
          ...(opts.activeOnly === false ? {} : { isActive: true }),
          ...(opts.search
            ? { OR: [{ name: { contains: opts.search, mode: 'insensitive' } }, { code: { contains: opts.search, mode: 'insensitive' } }] }
            : {}),
        },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async upsert(input: VendorInput, id?: string) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      if (id) {
        const before = await tx.vendor.findUniqueOrThrow({ where: { id } });
        const after = await tx.vendor.update({ where: { id }, data: input });
        await this.audit.log(tx, {
          action: 'UPDATE',
          entity: 'Vendor',
          entityId: id,
          ...diff(before as never, after as never),
        });
        return after;
      }
      const created = await tx.vendor.create({ data: { ...input, tenantId } });
      await this.audit.log(tx, { action: 'CREATE', entity: 'Vendor', entityId: created.id, after: created });
      return created;
    });
  }

  async setItemPrice(input: { vendorId: string; inventoryItemId: string; priceMinor: number; minOrderQty?: string }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      // Close the previous price rather than overwrite it, so "who was cheapest for
      // onions in October" stays answerable.
      await tx.vendorItemPrice.updateMany({
        where: { vendorId: input.vendorId, inventoryItemId: input.inventoryItemId, validTo: null },
        data: { validTo: new Date() },
      });
      return tx.vendorItemPrice.create({
        data: {
          tenantId,
          vendorId: input.vendorId,
          inventoryItemId: input.inventoryItemId,
          priceMinor: input.priceMinor,
          minOrderQty: input.minOrderQty ? new D(input.minOrderQty) : null,
        },
      });
    });
  }

  /** Current price from every vendor who sells this item — the negotiating screen. */
  async priceComparison(inventoryItemId: string) {
    return this.db.run((tx) =>
      tx.vendorItemPrice.findMany({
        where: { inventoryItemId, validTo: null },
        include: { vendor: { select: { id: true, name: true, phone: true, creditDays: true } } },
        orderBy: { priceMinor: 'asc' },
      }),
    );
  }

  // ─── Purchase orders ──────────────────────────────────────────────────────

  async createPurchaseOrder(input: PurchaseOrderInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const count = await tx.purchaseOrder.count();
      const poNumber = `PO/${new Date().getFullYear()}/${String(count + 1).padStart(5, '0')}`;

      let subtotal = 0;
      let tax = 0;
      const lines = input.lines.map((l) => {
        const lineTotal = Math.round(Number(l.orderedQty) * l.unitPriceMinor);
        const lineTax = Math.round((lineTotal * l.gstRateBp) / 10_000);
        subtotal += lineTotal;
        tax += lineTax;
        return {
          tenantId,
          inventoryItemId: l.inventoryItemId,
          orderedQty: new D(l.orderedQty),
          unitPriceMinor: l.unitPriceMinor,
          gstRateBp: l.gstRateBp,
          lineTotalMinor: lineTotal + lineTax,
        };
      });

      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          branchId: input.branchId,
          vendorId: input.vendorId,
          poNumber,
          status: 'APPROVED',
          expectedOn: input.expectedOn ? new Date(input.expectedOn) : null,
          notes: input.notes,
          subtotalMinor: subtotal,
          taxMinor: tax,
          totalMinor: subtotal + tax,
          raisedByUserId: TenantContext.actor()?.userId,
          lines: { create: lines },
        },
        include: { lines: true, vendor: true },
      });

      await this.audit.log(tx, {
        action: 'PO_CREATED',
        entity: 'PurchaseOrder',
        entityId: po.id,
        branchId: input.branchId,
        after: { poNumber, vendor: po.vendor.name, totalMinor: po.totalMinor },
      });
      return po;
    });
  }

  async listPurchaseOrders(branchId: string, status?: string) {
    return this.db.run((tx) =>
      tx.purchaseOrder.findMany({
        where: { branchId, ...(status ? { status: status as never } : {}) },
        include: {
          vendor: { select: { name: true, phone: true } },
          lines: { include: { item: { select: { name: true, sku: true, uom: { select: { code: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  // ─── Goods receipt ────────────────────────────────────────────────────────

  /**
   * Receiving goods. A separate document from the PO, not a status on it — because at a
   * mandi you order 10 kg of tomatoes and 8.4 kg arrive, two days late, in two
   * deliveries, and one crate is rejected. Each of those is a fact worth keeping.
   *
   * This is also where the weighted-average cost is updated, which means the food-cost
   * percentage moves the moment onion prices move, not at month end.
   */
  async receiveGoods(input: GoodsReceiptInput) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);
      const count = await tx.goodsReceipt.count();
      const reference = `GRN/${new Date().getFullYear()}/${String(count + 1).padStart(5, '0')}`;

      let total = 0;
      for (const l of input.lines) total += Math.round(Number(l.receivedQty) * l.unitPriceMinor);

      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId,
          branchId: input.branchId,
          purchaseOrderId: input.purchaseOrderId,
          reference,
          receivedOn: input.receivedOn ? new Date(input.receivedOn) : new Date(),
          receivedByUserId: TenantContext.actor()?.userId,
          billPhotoKey: input.billPhotoKey,
          notes: input.notes,
          totalMinor: total,
          lines: {
            create: input.lines.map((l) => ({
              tenantId,
              purchaseOrderLineId: l.purchaseOrderLineId,
              inventoryItemId: l.inventoryItemId,
              receivedQty: new D(l.receivedQty),
              rejectedQty: new D(l.rejectedQty),
              unitPriceMinor: l.unitPriceMinor,
              lineTotalMinor: Math.round(Number(l.receivedQty) * l.unitPriceMinor),
              batchNo: l.batchNo,
              expiryOn: l.expiryOn ? new Date(l.expiryOn) : null,
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of input.lines) {
        await this.stock.applyReceiptCost(tx, line.inventoryItemId, line.receivedQty, line.unitPriceMinor);
        await this.stock.post(
          {
            branchId: input.branchId,
            inventoryItemId: line.inventoryItemId,
            qtyDelta: line.receivedQty,
            reason: 'PURCHASE_RECEIPT',
            unitCostMinor: line.unitPriceMinor,
            goodsReceiptId: receipt.id,
            note: reference,
          },
          tx,
        );
        if (line.purchaseOrderLineId) {
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: { receivedQty: { increment: new D(line.receivedQty) } },
          });
        }
      }

      if (input.purchaseOrderId) await this.refreshPoStatus(tx, input.purchaseOrderId);

      // The vendor's paper bill, if it came with the delivery. Often it arrives later,
      // which is why billNo is optional here and can be attached afterwards.
      let vendorInvoice = null;
      if (input.billNo) {
        vendorInvoice = await this.recordVendorInvoice(tx, {
          vendorId: input.vendorId,
          purchaseOrderId: input.purchaseOrderId,
          billNo: input.billNo,
          billDate: input.billDate ?? new Date().toISOString().slice(0, 10),
          totalMinor: total,
        });
        await tx.goodsReceipt.update({
          where: { id: receipt.id },
          data: { vendorInvoiceId: vendorInvoice.id },
        });
      }

      await this.audit.log(tx, {
        action: 'GRN_RECEIVED',
        entity: 'GoodsReceipt',
        entityId: receipt.id,
        branchId: input.branchId,
        after: { reference, lines: input.lines.length, totalMinor: total, billNo: input.billNo },
      });

      return { receipt, vendorInvoice };
    });
  }

  private async refreshPoStatus(tx: Prisma.TransactionClient, purchaseOrderId: string) {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { lines: true },
    });
    const allReceived = po.lines.every((l) => new D(l.receivedQty).gte(l.orderedQty));
    const anyReceived = po.lines.some((l) => new D(l.receivedQty).gt(0));
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status },
    });
  }

  private async recordVendorInvoice(
    tx: Prisma.TransactionClient,
    input: { vendorId: string; purchaseOrderId?: string; billNo: string; billDate: string; totalMinor: number },
  ) {
    const tenantId = await currentTenant(tx);
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: input.vendorId } });
    const billDate = new Date(input.billDate);
    // Due date is derived from the vendor's credit terms rather than typed in, because
    // typed-in due dates are wrong and this is the field the payables screen sorts by.
    const dueOn = new Date(billDate.getTime() + vendor.creditDays * 86_400_000);

    return tx.vendorInvoice.upsert({
      where: { tenantId_vendorId_billNo: { tenantId, vendorId: input.vendorId, billNo: input.billNo } },
      create: {
        tenantId,
        vendorId: input.vendorId,
        purchaseOrderId: input.purchaseOrderId,
        billNo: input.billNo,
        billDate,
        dueOn,
        subtotalMinor: input.totalMinor,
        totalMinor: input.totalMinor,
      },
      update: {},
    });
  }

  // ─── Payables ─────────────────────────────────────────────────────────────

  /**
   * "Who do I owe, and when." Sorted by due date, with overdue first.
   *
   * These suppliers extend 7–15 days of credit on a handshake. The relationship is the
   * asset; this screen exists so it is never lost over a forgotten ₹4,000.
   */
  async payables(opts: { vendorId?: string; dueWithinDays?: number } = {}) {
    return this.db.run(async (tx) => {
      const cutoff = opts.dueWithinDays
        ? new Date(Date.now() + opts.dueWithinDays * 86_400_000)
        : undefined;

      const invoices = await tx.vendorInvoice.findMany({
        where: {
          status: { in: ['UNPAID', 'PARTIALLY_PAID', 'DISPUTED'] },
          ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
          ...(cutoff ? { dueOn: { lte: cutoff } } : {}),
        },
        include: { vendor: { select: { id: true, name: true, phone: true, upiId: true, creditDays: true } } },
        orderBy: { dueOn: 'asc' },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return invoices.map((i) => ({
        id: i.id,
        vendor: i.vendor,
        billNo: i.billNo,
        billDate: i.billDate,
        dueOn: i.dueOn,
        totalMinor: i.totalMinor,
        paidMinor: i.paidMinor,
        outstandingMinor: i.totalMinor - i.paidMinor,
        status: i.status,
        daysOverdue: Math.max(0, Math.floor((today.getTime() - i.dueOn.getTime()) / 86_400_000)),
        isOverdue: i.dueOn < today,
      }));
    });
  }

  /**
   * What is owed to each vendor, and how much of it is late.
   *
   * The sums come back from Postgres as BigInt, which `JSON.stringify` refuses outright —
   * the endpoint used to 500 with "Do not know how to serialize a BigInt" rather than
   * returning the money. Narrowed to Number here rather than left for the serialiser:
   * these are paise, and Number holds paise exactly up to about ₹90,000 crore.
   */
  async vendorBalances() {
    const rows = await this.db.run((tx) =>
      tx.$queryRaw<
        {
          vendor_id: string;
          name: string;
          credit_days: number;
          outstanding_minor: bigint;
          overdue_minor: bigint;
          next_due_on: Date | null;
        }[]
      >`SELECT vendor_id, name, credit_days, outstanding_minor, overdue_minor, next_due_on
        FROM v_vendor_balance
        WHERE outstanding_minor > 0
        ORDER BY overdue_minor DESC, next_due_on ASC NULLS LAST`,
    );

    return rows.map((r) => ({
      ...r,
      outstandingMinor: Number(r.outstanding_minor),
      overdueMinor: Number(r.overdue_minor),
      outstanding_minor: Number(r.outstanding_minor),
      overdue_minor: Number(r.overdue_minor),
    }));
  }

  /**
   * Record a payment. Unallocated amounts are applied oldest-bill-first, which is both
   * the convention and the right default for keeping credit terms intact.
   */
  async recordPayment(input: {
    vendorId: string;
    amountMinor: number;
    method: string;
    reference?: string;
    paidOn?: string;
    notes?: string;
    allocations: { vendorInvoiceId: string; amountMinor: number }[];
  }) {
    return this.db.run(async (tx) => {
      const tenantId = await currentTenant(tx);

      const payment = await tx.vendorPayment.create({
        data: {
          tenantId,
          vendorId: input.vendorId,
          amountMinor: input.amountMinor,
          method: input.method,
          reference: input.reference,
          paidOn: input.paidOn ? new Date(input.paidOn) : new Date(),
          paidByUserId: TenantContext.actor()?.userId,
          notes: input.notes,
        },
      });

      let allocations = input.allocations;
      if (allocations.length === 0) {
        const open = await tx.vendorInvoice.findMany({
          where: { vendorId: input.vendorId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
          orderBy: { dueOn: 'asc' },
        });
        let remaining = input.amountMinor;
        allocations = [];
        for (const inv of open) {
          if (remaining <= 0) break;
          const owed = inv.totalMinor - inv.paidMinor;
          const apply = Math.min(owed, remaining);
          allocations.push({ vendorInvoiceId: inv.id, amountMinor: apply });
          remaining -= apply;
        }
        if (remaining > 0) {
          // Paying more than is owed is usually a typo, occasionally an advance. Rejecting
          // it makes the person check; silently creating a credit balance does not.
          throw new BadRequestException(
            `₹${(remaining / 100).toFixed(2)} more than this vendor is owed — check the amount ` +
              'or allocate it to specific bills',
          );
        }
      }

      for (const a of allocations) {
        const invoice = await tx.vendorInvoice.findUniqueOrThrow({ where: { id: a.vendorInvoiceId } });
        const newPaid = invoice.paidMinor + a.amountMinor;
        if (newPaid > invoice.totalMinor) {
          throw new BadRequestException(`Allocation exceeds bill ${invoice.billNo}`);
        }
        await tx.vendorPaymentAllocation.create({
          data: { tenantId, vendorPaymentId: payment.id, vendorInvoiceId: a.vendorInvoiceId, amountMinor: a.amountMinor },
        });
        await tx.vendorInvoice.update({
          where: { id: a.vendorInvoiceId },
          data: { paidMinor: newPaid, status: newPaid >= invoice.totalMinor ? 'PAID' : 'PARTIALLY_PAID' },
        });
      }

      await this.audit.log(tx, {
        action: 'VENDOR_PAYMENT',
        entity: 'VendorPayment',
        entityId: payment.id,
        after: { vendorId: input.vendorId, amountMinor: input.amountMinor, method: input.method, allocations },
      });

      return { payment, allocations };
    });
  }
}
