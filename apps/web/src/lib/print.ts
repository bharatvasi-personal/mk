'use client';

import { formatMinor } from '@mk/shared';

export interface BillPayload {
  tenantName: string;
  fssaiNo?: string | null;
  gstin?: string | null;
  branch: { name: string; addressLine1: string; city: string; pincode: string; phone?: string | null };
  invoiceNo: string | null;
  tokenNo: number;
  channel: string;
  table?: string | null;
  issuedAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  lines: {
    name: string;
    variant: string;
    qty: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
    modifiers?: { name: string; priceDeltaMinor: number }[];
  }[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  roundOffMinor: number;
  totalMinor: number;
  payments: { tender: string; amountMinor: number; reference?: string | null }[];
}

const WIDTH = 32; // characters on a 58mm thermal roll at font size 10

function line(char = '-'): string {
  return char.repeat(WIDTH);
}

function centre(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function row(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

/**
 * Renders the bill as monospaced text for a 58mm thermal printer.
 *
 * Plain text rather than a styled HTML receipt, because a 58mm roll is 32 characters
 * wide and every ESC/POS printer on the market renders monospace text identically.
 * A pretty HTML receipt reflows differently on every driver.
 */
export function renderThermalBill(bill: BillPayload, opts: { copy?: 'CUSTOMER' | 'DUPLICATE' } = {}): string {
  const out: string[] = [];
  out.push(centre(bill.tenantName.toUpperCase()));
  out.push(centre(bill.branch.name));
  out.push(centre(bill.branch.addressLine1.slice(0, WIDTH)));
  out.push(centre(`${bill.branch.city} ${bill.branch.pincode}`));
  if (bill.branch.phone) out.push(centre(`Ph: ${bill.branch.phone}`));
  if (bill.gstin) out.push(centre(`GSTIN: ${bill.gstin}`));
  if (bill.fssaiNo) out.push(centre(`FSSAI: ${bill.fssaiNo}`));
  out.push(line('='));

  if (opts.copy === 'DUPLICATE') out.push(centre('*** DUPLICATE ***'));
  out.push(row(`Bill: ${bill.invoiceNo ?? '-'}`, `Token ${bill.tokenNo}`));
  out.push(
    row(
      new Date(bill.issuedAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'short',
        timeStyle: 'short',
      }),
      bill.table ? `Table ${bill.table}` : bill.channel.replace('_', ' '),
    ),
  );
  if (bill.customerName || bill.customerPhone) {
    out.push(`${bill.customerName ?? ''} ${bill.customerPhone ?? ''}`.trim().slice(0, WIDTH));
  }
  out.push(line());
  out.push(row('Item', 'Amount'));
  out.push(line());

  for (const l of bill.lines) {
    const title = `${l.name}${l.variant && l.variant !== 'Regular' ? ` (${l.variant})` : ''}`;
    out.push(title.slice(0, WIDTH));
    // Add-ons under the dish, each on its own indented line, so the bill reads what the
    // customer actually got and the paid ones are visible against the line total.
    for (const m of l.modifiers ?? []) {
      out.push(
        `  + ${m.name}${m.priceDeltaMinor ? ` (${formatMinor(m.priceDeltaMinor, { withSymbol: false })})` : ''}`.slice(0, WIDTH),
      );
    }
    out.push(row(`  ${l.qty} x ${formatMinor(l.unitPriceMinor, { withSymbol: false })}`, formatMinor(l.lineTotalMinor, { withSymbol: false })));
  }

  out.push(line());
  out.push(row('Subtotal', formatMinor(bill.subtotalMinor, { withSymbol: false })));
  if (bill.discountMinor > 0) out.push(row('Discount', `-${formatMinor(bill.discountMinor, { withSymbol: false })}`));
  // Menu prices are GST-inclusive, so the tax lines are shown as "included" — printing
  // them as additions would imply the customer is paying it twice.
  out.push(row('CGST (incl.)', formatMinor(bill.cgstMinor, { withSymbol: false })));
  out.push(row('SGST (incl.)', formatMinor(bill.sgstMinor, { withSymbol: false })));
  if (bill.roundOffMinor !== 0) {
    out.push(row('Round off', formatMinor(bill.roundOffMinor, { withSymbol: false })));
  }
  out.push(line('='));
  out.push(row('TOTAL', formatMinor(bill.totalMinor, { withSymbol: false })));
  out.push(line('='));

  for (const p of bill.payments) {
    out.push(row(p.tender.replace('_', ' '), formatMinor(p.amountMinor, { withSymbol: false })));
    if (p.reference) out.push(`  Ref: ${p.reference}`.slice(0, WIDTH));
  }

  out.push('');
  out.push(centre('Thank you. Come again.'));
  out.push(centre('Home food, made honestly.'));
  out.push('');
  return out.join('\n');
}

/**
 * Prints via the browser. The hidden `#thermal-bill` element is the only visible thing
 * in the print stylesheet.
 *
 * Browser printing rather than WebUSB ESC/POS: it works with any printer the tablet or
 * the shop's Android device can already see, including a shared network printer, and it
 * needs no driver work on day one. A direct WebUSB path can be added later for speed
 * without changing how the bill is composed.
 */
export function printBill(text: string): void {
  const el = document.getElementById('thermal-bill');
  if (!el) return;
  el.textContent = text;
  window.print();
}
