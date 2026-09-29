"use strict";
/**
 * Unit-of-measure conversion.
 *
 * A recipe is written the way a cook thinks — "180 g paneer" — while stock is held the
 * way it is bought — "paneer, kg". Without a conversion between the two, a recipe line of
 * 180 g deducts 180 kg from the ledger, and both the stock position and the food-cost
 * percentage are silently destroyed. Silently, because nothing errors: the numbers are
 * just wrong, and stay wrong until someone counts.
 *
 * So conversion is explicit, and an impossible conversion is an error rather than a
 * guess. Litres cannot become kilograms without a density nobody has entered, and
 * inventing a factor there would be worse than refusing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_UOMS = exports.IncompatibleUomError = void 0;
exports.baseOf = baseOf;
exports.areCompatible = areCompatible;
exports.convertQty = convertQty;
class IncompatibleUomError extends Error {
    from;
    to;
    constructor(from, to) {
        super(`Cannot convert ${from} to ${to} — they measure different things. ` +
            `Record the recipe in a unit compatible with how the item is stocked.`);
        this.from = from;
        this.to = to;
        this.name = 'IncompatibleUomError';
    }
}
exports.IncompatibleUomError = IncompatibleUomError;
/** The unit a UoM is ultimately expressed in. A base unit is its own base. */
function baseOf(uom) {
    return uom.baseCode ?? uom.code;
}
function factor(uom) {
    if (uom.factorToBase === null || uom.factorToBase === undefined)
        return 1;
    const n = Number(uom.factorToBase.toString());
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`UoM "${uom.code}" has an invalid conversion factor: ${uom.factorToBase}`);
    }
    return n;
}
function areCompatible(from, to) {
    return from.code === to.code || baseOf(from) === baseOf(to);
}
/**
 * Converts a quantity between two units that share a base.
 *
 * Returns a string rather than a number so the caller can hand it straight to a
 * `Decimal` column without a float round-trip — the same reason money is integer paise
 * everywhere else in this system.
 */
function convertQty(qty, from, to) {
    const value = Number(qty);
    if (!Number.isFinite(value))
        throw new Error(`Not a quantity: ${qty}`);
    if (from.code === to.code)
        return trim(value);
    if (!areCompatible(from, to))
        throw new IncompatibleUomError(from.code, to.code);
    return trim((value * factor(from)) / factor(to));
}
/**
 * Four decimal places, matching the `Decimal(14,4)` columns quantities live in.
 * Trailing zeroes are dropped so a converted value reads like a quantity a person wrote.
 */
function trim(value) {
    const fixed = value.toFixed(4);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') || '0' : fixed;
}
/** The units this system ships with. Seeded per tenant; more can be added. */
exports.STANDARD_UOMS = [
    { code: 'kg', name: 'Kilogram' },
    { code: 'g', name: 'Gram', baseCode: 'kg', factorToBase: 0.001 },
    { code: 'L', name: 'Litre' },
    { code: 'ml', name: 'Millilitre', baseCode: 'L', factorToBase: 0.001 },
    { code: 'pcs', name: 'Pieces' },
    { code: 'dozen', name: 'Dozen', baseCode: 'pcs', factorToBase: 12 },
    { code: 'pkt', name: 'Packet' },
    { code: 'cyl', name: 'Gas cylinder' },
    { code: 'bundle', name: 'Bundle' },
];
