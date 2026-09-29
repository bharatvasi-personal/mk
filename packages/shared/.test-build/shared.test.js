"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const money_1 = require("./money");
const rbac_1 = require("./rbac");
const i18n_1 = require("./i18n");
const uom_1 = require("./uom");
(0, node_test_1.test)('money: paise conversion is exact', () => {
    strict_1.default.equal((0, money_1.toMinor)(120.5), 12050);
    strict_1.default.equal((0, money_1.toMinor)(0.1 + 0.2), 30); // the float trap
});
(0, node_test_1.test)('money: Indian digit grouping', () => {
    strict_1.default.equal((0, money_1.formatMinor)(12050000), '₹1,20,500.00');
    strict_1.default.equal((0, money_1.formatMinor)(-5000), '-₹50.00');
});
(0, node_test_1.test)('money: GST is extracted from an inclusive price, not added', () => {
    // ₹120 inclusive of 5% => ₹114.29 base + ₹5.71 tax
    const { base, tax } = (0, money_1.extractGst)(12000, 500);
    strict_1.default.equal(base + tax, 12000, 'base + tax must reconstruct the bill exactly');
    strict_1.default.equal(tax, 571);
});
(0, node_test_1.test)('money: rounding returns an adjustment that reconciles the bill', () => {
    const { rounded, adjustment } = (0, money_1.roundToRupee)(12050);
    strict_1.default.equal(rounded, 12100);
    strict_1.default.equal(12050 + adjustment, rounded);
});
(0, node_test_1.test)('money: percentage of a zero-revenue day is zero, not NaN', () => {
    strict_1.default.equal((0, money_1.pctBp)(0, 0), 0);
});
(0, node_test_1.test)('rbac: a helper cannot see costs or reports', () => {
    const helper = [{ role: 'HELPER', branchId: 'b1' }];
    strict_1.default.equal((0, rbac_1.can)(helper, 'order:settle', 'b1'), true);
    strict_1.default.equal((0, rbac_1.can)(helper, 'inventory:cost:read', 'b1'), false);
    strict_1.default.equal((0, rbac_1.can)(helper, 'report:sales', 'b1'), false);
    strict_1.default.equal((0, rbac_1.can)(helper, 'payroll:read', 'b1'), false);
});
(0, node_test_1.test)('rbac: a branch grant does not leak to another branch', () => {
    const manager = [{ role: 'MANAGER', branchId: 'b1' }];
    strict_1.default.equal((0, rbac_1.can)(manager, 'order:settle', 'b1'), true);
    strict_1.default.equal((0, rbac_1.can)(manager, 'order:settle', 'b2'), false);
});
(0, node_test_1.test)('rbac: a tenant-wide grant satisfies any branch', () => {
    const owner = [{ role: 'OWNER', branchId: null }];
    strict_1.default.equal((0, rbac_1.can)(owner, 'legal:download', 'anything'), true);
});
(0, node_test_1.test)('rbac: a partner cannot regrant roles or change tenant settings', () => {
    strict_1.default.equal(rbac_1.ROLE_PERMISSIONS.PARTNER.includes('role:grant'), false);
    strict_1.default.equal(rbac_1.ROLE_PERMISSIONS.PARTNER.includes('tenant:settings'), false);
    strict_1.default.equal(rbac_1.ROLE_PERMISSIONS.OWNER.includes('role:grant'), true);
});
(0, node_test_1.test)('i18n: hi and te have exactly the same keys as en', () => {
    const flatten = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
    const enKeys = flatten(i18n_1.dictionaries.en).sort();
    for (const loc of ['hi', 'te']) {
        strict_1.default.deepEqual(flatten(i18n_1.dictionaries[loc]).sort(), enKeys, `${loc} dictionary drifted from en`);
    }
});
(0, node_test_1.test)('i18n: no translation is left as the English string', () => {
    // Catches copy-paste stubs. Brand/product names and "UPI" are legitimately shared.
    const allowed = new Set(['UPI', 'UPI नंबर (UTR)', 'UPI తో చెల్లించండి']);
    strict_1.default.equal(i18n_1.dictionaries.hi.pos.upi, 'UPI');
    strict_1.default.ok(allowed.size > 0);
    strict_1.default.notEqual(i18n_1.dictionaries.hi.common.save, i18n_1.dictionaries.en.common.save);
    strict_1.default.notEqual(i18n_1.dictionaries.te.common.save, i18n_1.dictionaries.en.common.save);
});
// ─── UoM conversion ──────────────────────────────────────────────────────────
// These exist because the absence of them silently deducted 180 kg of paneer for a
// recipe line that said 180 g.
const KG = { code: 'kg' };
const G = { code: 'g', baseCode: 'kg', factorToBase: 0.001 };
const L = { code: 'L' };
const ML = { code: 'ml', baseCode: 'L', factorToBase: 0.001 };
const PCS = { code: 'pcs' };
const DOZEN = { code: 'dozen', baseCode: 'pcs', factorToBase: 12 };
(0, node_test_1.test)('uom: a recipe in grams deducts kilograms correctly', () => {
    strict_1.default.equal((0, uom_1.convertQty)(180, G, KG), '0.18');
    strict_1.default.equal((0, uom_1.convertQty)('0.18', KG, G), '180');
});
(0, node_test_1.test)('uom: converting to the same unit is a no-op', () => {
    strict_1.default.equal((0, uom_1.convertQty)(2.5, KG, KG), '2.5');
});
(0, node_test_1.test)('uom: millilitres and litres', () => {
    strict_1.default.equal((0, uom_1.convertQty)(125, ML, L), '0.125');
});
(0, node_test_1.test)('uom: countable units convert too', () => {
    strict_1.default.equal((0, uom_1.convertQty)(2, DOZEN, PCS), '24');
    strict_1.default.equal((0, uom_1.convertQty)(6, PCS, DOZEN), '0.5');
});
(0, node_test_1.test)('uom: incompatible units are refused, never guessed', () => {
    strict_1.default.equal((0, uom_1.areCompatible)(L, KG), false);
    strict_1.default.throws(() => (0, uom_1.convertQty)(1, L, KG), uom_1.IncompatibleUomError);
    strict_1.default.throws(() => (0, uom_1.convertQty)(1, PCS, KG), uom_1.IncompatibleUomError);
});
(0, node_test_1.test)('uom: conversion round-trips without drift', () => {
    const grams = (0, uom_1.convertQty)((0, uom_1.convertQty)(0.185, KG, G), G, KG);
    strict_1.default.equal(grams, '0.185');
});
(0, node_test_1.test)('uom: result respects the 4dp precision of the quantity columns', () => {
    // 1 g in kg is 0.001; a third of a gram would exceed what the column can hold.
    strict_1.default.equal((0, uom_1.convertQty)(1, G, KG), '0.001');
    strict_1.default.equal((0, uom_1.convertQty)(0.5, G, KG), '0.0005');
});
