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
const csv_1 = require("./csv");
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
// ─── CSV ─────────────────────────────────────────────────────────────────────
// These exist because the files this reads will be exported from Excel by someone who
// has never heard of RFC 4180.
(0, node_test_1.test)('csv: quoted fields, embedded commas and doubled quotes', () => {
    const rows = (0, csv_1.parseCsvLines)('a,b\n"one, two","he said ""hi"""');
    strict_1.default.deepEqual(rows, [
        ['a', 'b'],
        ['one, two', 'he said "hi"'],
    ]);
});
(0, node_test_1.test)('csv: Windows line endings and the BOM Excel adds', () => {
    const rows = (0, csv_1.parseCsvLines)('\ufeffsku,name\r\nRICE,Sona Masoori\r\n');
    strict_1.default.deepEqual(rows, [
        ['sku', 'name'],
        ['RICE', 'Sona Masoori'],
    ]);
});
(0, node_test_1.test)('csv: newlines inside a quoted field do not end the row', () => {
    const rows = (0, csv_1.parseCsvLines)('name,notes\nDal,"buy weekly\nfrom kirana"');
    strict_1.default.equal(rows.length, 2);
    strict_1.default.equal(rows[1]?.[1], 'buy weekly\nfrom kirana');
});
(0, node_test_1.test)('csv: headers match regardless of case, spaces or underscores', () => {
    const result = (0, csv_1.parseCsv)('SKU,Reorder Point\nRICE,5', {
        required: ['sku', 'reorderPoint'],
    });
    strict_1.default.deepEqual(result.missingHeaders, []);
    strict_1.default.equal(result.rows[0]?.sku, 'RICE');
    strict_1.default.equal(result.rows[0]?.reorderPoint, '5');
});
(0, node_test_1.test)('csv: missing and unknown headers are reported, not guessed at', () => {
    const result = (0, csv_1.parseCsv)('sku,colour\nRICE,white', { required: ['sku', 'name'] });
    strict_1.default.deepEqual(result.missingHeaders, ['name']);
    strict_1.default.deepEqual(result.unknownHeaders, ['colour']);
});
(0, node_test_1.test)('csv: blank trailing rows are dropped', () => {
    const result = (0, csv_1.parseCsv)('sku\nRICE\n\n', { required: ['sku'] });
    strict_1.default.equal(result.rows.length, 1);
});
(0, node_test_1.test)('csv: money is read the way people type it', () => {
    strict_1.default.equal((0, csv_1.csvMoneyMinor)('120'), 12000);
    strict_1.default.equal((0, csv_1.csvMoneyMinor)('120.50'), 12050);
    strict_1.default.equal((0, csv_1.csvMoneyMinor)('₹1,200'), 120000);
    strict_1.default.equal((0, csv_1.csvMoneyMinor)(''), null);
    strict_1.default.equal((0, csv_1.csvMoneyMinor)('abc'), null);
});
(0, node_test_1.test)('csv: dates accept the DD/MM/YYYY Indian spreadsheets default to', () => {
    strict_1.default.equal((0, csv_1.csvDate)('2026-10-15'), '2026-10-15');
    strict_1.default.equal((0, csv_1.csvDate)('15/10/2026'), '2026-10-15');
    strict_1.default.equal((0, csv_1.csvDate)('5/1/2026'), '2026-01-05');
    strict_1.default.equal((0, csv_1.csvDate)('nonsense'), null);
});
(0, node_test_1.test)('csv: booleans and enums are matched loosely', () => {
    strict_1.default.equal((0, csv_1.csvBool)('yes'), true);
    strict_1.default.equal((0, csv_1.csvBool)('TRUE'), true);
    strict_1.default.equal((0, csv_1.csvBool)(''), false);
    strict_1.default.equal((0, csv_1.csvEnum)('non veg', ['VEG', 'NON_VEG']), 'NON_VEG');
    strict_1.default.equal((0, csv_1.csvEnum)('vEg', ['VEG', 'NON_VEG']), 'VEG');
    strict_1.default.equal((0, csv_1.csvEnum)('fish', ['VEG', 'NON_VEG']), null);
});
(0, node_test_1.test)('csv: round-trips through toCsv', () => {
    const text = (0, csv_1.toCsv)(['name', 'notes'], [['Dal, toor', 'said "buy"']]);
    const back = (0, csv_1.parseCsvLines)(text);
    strict_1.default.deepEqual(back[1], ['Dal, toor', 'said "buy"']);
});
// ─── RBAC: branch scoping ────────────────────────────────────────────────────
// These exist because `can()` answers "anywhere" when no branch is given, which is right
// for the shared catalogue and wrong for a record that belongs to a branch.
const MANAGER_A = [{ role: 'MANAGER', branchId: 'branch-a' }];
const OWNER_ANY = [{ role: 'OWNER', branchId: null }];
const TWO_HATS = [
    { role: 'MANAGER', branchId: 'branch-a' },
    { role: 'HELPER', branchId: 'branch-b' },
];
(0, node_test_1.test)('rbac: canAt refuses a permission held only at another branch', () => {
    strict_1.default.equal((0, rbac_1.canAt)(MANAGER_A, 'order:settle', 'branch-a'), true);
    strict_1.default.equal((0, rbac_1.canAt)(MANAGER_A, 'order:settle', 'branch-b'), false);
});
(0, node_test_1.test)('rbac: a tenant-wide grant satisfies canAt at every branch', () => {
    strict_1.default.equal((0, rbac_1.canAt)(OWNER_ANY, 'order:settle', 'branch-a'), true);
    strict_1.default.equal((0, rbac_1.canAt)(OWNER_ANY, 'order:settle', 'anything-at-all'), true);
});
(0, node_test_1.test)('rbac: can() without a branch means anywhere — the shared catalogue case', () => {
    // A manager of one branch may edit the tenant-level dish catalogue.
    strict_1.default.equal((0, rbac_1.can)(MANAGER_A, 'menu:write'), true);
    // But that must not become permission at a branch they do not hold.
    strict_1.default.equal((0, rbac_1.canAt)(MANAGER_A, 'menu:write', 'branch-b'), false);
});
(0, node_test_1.test)('rbac: two roles at two branches keep their own scopes', () => {
    // Manager at A, helper at B: may void at A, may not void at B.
    strict_1.default.equal((0, rbac_1.canAt)(TWO_HATS, 'order:void', 'branch-a'), true);
    strict_1.default.equal((0, rbac_1.canAt)(TWO_HATS, 'order:void', 'branch-b'), false);
    // Helper powers apply at B.
    strict_1.default.equal((0, rbac_1.canAt)(TWO_HATS, 'order:settle', 'branch-b'), true);
});
(0, node_test_1.test)('rbac: every role maps only to permissions that exist', () => {
    for (const role of rbac_1.ROLES) {
        for (const p of rbac_1.ROLE_PERMISSIONS[role]) {
            strict_1.default.ok(rbac_1.PERMISSIONS.includes(p), `${role} grants unknown permission ${p}`);
        }
    }
});
(0, node_test_1.test)('rbac: every permission is reachable by at least one role', () => {
    const granted = new Set(rbac_1.ROLES.flatMap((r) => [...rbac_1.ROLE_PERMISSIONS[r]]));
    const orphans = rbac_1.PERMISSIONS.filter((p) => !granted.has(p));
    strict_1.default.deepEqual(orphans, [], `permissions no role can ever hold: ${orphans.join(', ')}`);
});
(0, node_test_1.test)('rbac: the money and secrets boundary holds for every non-owner role', () => {
    // The specific things a helper or chef must never reach, checked as a set rather than
    // one assertion each so adding a role cannot quietly widen it.
    const forbiddenForFloorStaff = [
        'inventory:cost:read', 'report:sales', 'report:cost', 'payroll:read', 'payroll:run',
        'legal:read', 'legal:download', 'role:grant', 'tenant:settings', 'audit:read',
        'payable:pay', 'salary:read',
    ];
    for (const role of ['HELPER', 'CHEF']) {
        for (const p of forbiddenForFloorStaff) {
            strict_1.default.equal(rbac_1.ROLE_PERMISSIONS[role].includes(p), false, `${role} must not hold ${p}`);
        }
    }
});
(0, node_test_1.test)('rbac: only the owner may re-grant access or change tenant settings', () => {
    for (const role of rbac_1.ROLES) {
        const expected = role === 'OWNER';
        strict_1.default.equal(rbac_1.ROLE_PERMISSIONS[role].includes('role:grant'), expected, `${role} role:grant`);
        strict_1.default.equal(rbac_1.ROLE_PERMISSIONS[role].includes('tenant:settings'), expected, `${role} tenant:settings`);
    }
});
(0, node_test_1.test)('rbac: an accountant can read money but cannot change operations', () => {
    const acct = rbac_1.ROLE_PERMISSIONS.ACCOUNTANT;
    strict_1.default.ok(acct.includes('report:cost'));
    strict_1.default.ok(acct.includes('payable:pay'));
    strict_1.default.equal(acct.includes('menu:write'), false);
    strict_1.default.equal(acct.includes('order:create'), false);
    strict_1.default.equal(acct.includes('employee:write'), false);
});
(0, node_test_1.test)('rbac: no grants at all means no permission', () => {
    strict_1.default.equal((0, rbac_1.can)([], 'order:read'), false);
    strict_1.default.equal((0, rbac_1.canAt)([], 'order:read', 'branch-a'), false);
});
