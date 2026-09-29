import { extractGst, roundToRupee } from '@mk/shared';

export interface PricedLine {
  variantId: string;
  menuItemId: string;
  nameSnapshot: string;
  variantSnapshot: string;
  qty: number;
  unitPriceMinor: number;
  gstRateBp: number;
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
  notes?: string;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  roundOffMinor: number;
  totalMinor: number;
}

/**
 * Bill arithmetic, in one place, with one rule: **the total is what the customer pays,
 * and every other number is derived from it.**
 *
 * Indian restaurant menus are quoted GST-inclusive, so tax is *extracted* from the
 * line total rather than added on top. A ₹120 thali at 5% is ₹114.29 + ₹5.71, never
 * ₹126. Getting this backwards is the single most common billing bug in Indian POS
 * software and it makes every GST return wrong.
 *
 * A discount reduces the taxable base proportionally, so tax is computed on the
 * discounted amount — which is what the law requires and what a customer expects.
 */
export function priceOrder(
  lines: Omit<PricedLine, 'lineSubtotalMinor' | 'lineDiscountMinor' | 'lineTaxMinor' | 'lineTotalMinor'>[],
  opts: { discountMinor?: number; roundOff?: boolean } = {},
): PricedOrder {
  const discountMinor = opts.discountMinor ?? 0;

  const priced: PricedLine[] = lines.map((l) => {
    const lineTotal = l.unitPriceMinor * l.qty;
    return {
      ...l,
      lineSubtotalMinor: lineTotal,
      lineDiscountMinor: 0,
      lineTaxMinor: 0,
      lineTotalMinor: lineTotal,
    };
  });

  const grossMinor = priced.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  if (discountMinor > grossMinor) {
    throw new Error('Discount cannot exceed the order value');
  }

  const netMinor = grossMinor - discountMinor;

  // Apportion the discount across lines by value so each line's tax is right, and
  // absorb the rounding remainder on the last line so the parts always sum to the whole.
  let taxMinor = 0;
  let apportioned = 0;
  priced.forEach((line, index) => {
    const isLast = index === priced.length - 1;
    const share = isLast
      ? discountMinor - apportioned
      : Math.round((line.lineTotalMinor / Math.max(1, grossMinor)) * discountMinor);
    apportioned += share;

    const lineNet = line.lineTotalMinor - share;
    const { tax } = extractGst(lineNet, line.gstRateBp);
    line.lineDiscountMinor = share;
    line.lineTaxMinor = tax;
    line.lineTotalMinor = lineNet;
    taxMinor += tax;
  });

  const { adjustment } = opts.roundOff === false ? { adjustment: 0 } : roundToRupee(netMinor);

  return {
    lines: priced,
    subtotalMinor: grossMinor,
    discountMinor,
    taxMinor,
    roundOffMinor: adjustment,
    totalMinor: netMinor + adjustment,
  };
}

/** India's financial year runs April–March. "2026-27" for anything from Apr 2026. */
export function financialYear(date: Date, startMonth = 4): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
