"use strict";
/**
 * Money is integer paise throughout the system. ₹120.50 === 12050.
 *
 * There is exactly one representation, in the database, over the wire, and in the
 * UI, and it is exact. Every rounding decision in the app funnels through this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUPEE = void 0;
exports.toMinor = toMinor;
exports.toRupees = toRupees;
exports.formatMinor = formatMinor;
exports.formatMinorCompact = formatMinorCompact;
exports.extractGst = extractGst;
exports.addGst = addGst;
exports.roundToRupee = roundToRupee;
exports.pctBp = pctBp;
exports.formatBp = formatBp;
exports.RUPEE = 100;
function toMinor(rupees) {
    return Math.round(rupees * exports.RUPEE);
}
function toRupees(minor) {
    return minor / exports.RUPEE;
}
/** ₹1,20,500.50 — Indian digit grouping, which `en-IN` gets right and `en-US` does not. */
function formatMinor(minor, opts = {}) {
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
function formatMinorCompact(minor) {
    const r = toRupees(minor);
    const abs = Math.abs(r);
    if (abs >= 1_00_00_000)
        return `₹${(r / 1_00_00_000).toFixed(2)}Cr`;
    if (abs >= 1_00_000)
        return `₹${(r / 1_00_000).toFixed(2)}L`;
    if (abs >= 1_000)
        return `₹${(r / 1_000).toFixed(1)}K`;
    return `₹${r.toFixed(0)}`;
}
/**
 * Indian menu prices are quoted GST-inclusive, so tax must be *extracted* from the
 * line total rather than added to it. 5% restaurant GST on ₹120 means ₹114.29 + ₹5.71,
 * not ₹126.
 */
function extractGst(inclusiveMinor, rateBp) {
    if (rateBp <= 0)
        return { base: inclusiveMinor, tax: 0 };
    const base = Math.round((inclusiveMinor * 10_000) / (10_000 + rateBp));
    return { base, tax: inclusiveMinor - base };
}
function addGst(exclusiveMinor, rateBp) {
    return exclusiveMinor + Math.round((exclusiveMinor * rateBp) / 10_000);
}
/**
 * Cash bills round to the nearest rupee — nobody at a thali counter has 50 paise.
 * Returns the adjustment, which is stored on the order as `roundOffMinor` so the
 * bill arithmetic reconciles exactly.
 */
function roundToRupee(minor) {
    const rounded = Math.round(minor / exports.RUPEE) * exports.RUPEE;
    return { rounded, adjustment: rounded - minor };
}
/** Basis points, so 32.5% is 3250. Guards divide-by-zero on a zero-revenue day. */
function pctBp(part, whole) {
    if (!whole)
        return 0;
    return Math.round((part / whole) * 10_000);
}
function formatBp(bp, digits = 1) {
    return `${(bp / 100).toFixed(digits)}%`;
}
