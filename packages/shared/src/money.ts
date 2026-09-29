/**
 * Money is integer paise throughout the system. ₹120.50 === 12050.
 *
 * There is exactly one representation, in the database, over the wire, and in the
 * UI, and it is exact. Every rounding decision in the app funnels through this file.
 */

export type Minor = number;

export const RUPEE = 100;

export function toMinor(rupees: number): Minor {
  return Math.round(rupees * RUPEE);
}

export function toRupees(minor: Minor): number {
  return minor / RUPEE;
}

/** ₹1,20,500.50 — Indian digit grouping, which `en-IN` gets right and `en-US` does not. */
export function formatMinor(minor: Minor, opts: { withSymbol?: boolean } = {}): string {
  const { withSymbol = true } = opts;
  const value = toRupees(Math.abs(minor));
  const body = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const sign = minor < 0 ? '-' : '';
  return `${sign}${withSymbol ? '₹' : ''}${body}`;
}

/** Compact form for dashboards: ₹1.2L, ₹45.6K. */
export function formatMinorCompact(minor: Minor): string {
  const r = toRupees(minor);
  const abs = Math.abs(r);
  if (abs >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(r / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(r / 1_000).toFixed(1)}K`;
  return `₹${r.toFixed(0)}`;
}

/**
 * Indian menu prices are quoted GST-inclusive, so tax must be *extracted* from the
 * line total rather than added to it. 5% restaurant GST on ₹120 means ₹114.29 + ₹5.71,
 * not ₹126.
 */
export function extractGst(inclusiveMinor: Minor, rateBp: number): { base: Minor; tax: Minor } {
  if (rateBp <= 0) return { base: inclusiveMinor, tax: 0 };
  const base = Math.round((inclusiveMinor * 10_000) / (10_000 + rateBp));
  return { base, tax: inclusiveMinor - base };
}

export function addGst(exclusiveMinor: Minor, rateBp: number): Minor {
  return exclusiveMinor + Math.round((exclusiveMinor * rateBp) / 10_000);
}

/**
 * Cash bills round to the nearest rupee — nobody at a thali counter has 50 paise.
 * Returns the adjustment, which is stored on the order as `roundOffMinor` so the
 * bill arithmetic reconciles exactly.
 */
export function roundToRupee(minor: Minor): { rounded: Minor; adjustment: Minor } {
  const rounded = Math.round(minor / RUPEE) * RUPEE;
  return { rounded, adjustment: rounded - minor };
}

/** Basis points, so 32.5% is 3250. Guards divide-by-zero on a zero-revenue day. */
export function pctBp(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 10_000);
}

export function formatBp(bp: number, digits = 1): string {
  return `${(bp / 100).toFixed(digits)}%`;
}
