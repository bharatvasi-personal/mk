import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractGst, formatMinor, pctBp, roundToRupee, toMinor } from './money';
import { can, ROLE_PERMISSIONS } from './rbac';
import { dictionaries } from './i18n';
import { areCompatible, convertQty, IncompatibleUomError } from './uom';
import { csvBool, csvDate, csvEnum, csvMoneyMinor, parseCsv, parseCsvLines, toCsv } from './csv';

test('money: paise conversion is exact', () => {
  assert.equal(toMinor(120.5), 12050);
  assert.equal(toMinor(0.1 + 0.2), 30); // the float trap
});

test('money: Indian digit grouping', () => {
  assert.equal(formatMinor(12050000), '₹1,20,500.00');
  assert.equal(formatMinor(-5000), '-₹50.00');
});

test('money: GST is extracted from an inclusive price, not added', () => {
  // ₹120 inclusive of 5% => ₹114.29 base + ₹5.71 tax
  const { base, tax } = extractGst(12000, 500);
  assert.equal(base + tax, 12000, 'base + tax must reconstruct the bill exactly');
  assert.equal(tax, 571);
});

test('money: rounding returns an adjustment that reconciles the bill', () => {
  const { rounded, adjustment } = roundToRupee(12050);
  assert.equal(rounded, 12100);
  assert.equal(12050 + adjustment, rounded);
});

test('money: percentage of a zero-revenue day is zero, not NaN', () => {
  assert.equal(pctBp(0, 0), 0);
});

test('rbac: a helper cannot see costs or reports', () => {
  const helper = [{ role: 'HELPER' as const, branchId: 'b1' }];
  assert.equal(can(helper, 'order:settle', 'b1'), true);
  assert.equal(can(helper, 'inventory:cost:read', 'b1'), false);
  assert.equal(can(helper, 'report:sales', 'b1'), false);
  assert.equal(can(helper, 'payroll:read', 'b1'), false);
});

test('rbac: a branch grant does not leak to another branch', () => {
  const manager = [{ role: 'MANAGER' as const, branchId: 'b1' }];
  assert.equal(can(manager, 'order:settle', 'b1'), true);
  assert.equal(can(manager, 'order:settle', 'b2'), false);
});

test('rbac: a tenant-wide grant satisfies any branch', () => {
  const owner = [{ role: 'OWNER' as const, branchId: null }];
  assert.equal(can(owner, 'legal:download', 'anything'), true);
});

test('rbac: a partner cannot regrant roles or change tenant settings', () => {
  assert.equal(ROLE_PERMISSIONS.PARTNER.includes('role:grant'), false);
  assert.equal(ROLE_PERMISSIONS.PARTNER.includes('tenant:settings'), false);
  assert.equal(ROLE_PERMISSIONS.OWNER.includes('role:grant'), true);
});

test('i18n: hi and te have exactly the same keys as en', () => {
  const flatten = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  const enKeys = flatten(dictionaries.en).sort();
  for (const loc of ['hi', 'te'] as const) {
    assert.deepEqual(flatten(dictionaries[loc]).sort(), enKeys, `${loc} dictionary drifted from en`);
  }
});

test('i18n: no translation is left as the English string', () => {
  // Catches copy-paste stubs. Brand/product names and "UPI" are legitimately shared.
  const allowed = new Set(['UPI', 'UPI नंबर (UTR)', 'UPI తో చెల్లించండి']);
  assert.equal(dictionaries.hi.pos.upi, 'UPI');
  assert.ok(allowed.size > 0);
  assert.notEqual(dictionaries.hi.common.save, dictionaries.en.common.save);
  assert.notEqual(dictionaries.te.common.save, dictionaries.en.common.save);
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

test('uom: a recipe in grams deducts kilograms correctly', () => {
  assert.equal(convertQty(180, G, KG), '0.18');
  assert.equal(convertQty('0.18', KG, G), '180');
});

test('uom: converting to the same unit is a no-op', () => {
  assert.equal(convertQty(2.5, KG, KG), '2.5');
});

test('uom: millilitres and litres', () => {
  assert.equal(convertQty(125, ML, L), '0.125');
});

test('uom: countable units convert too', () => {
  assert.equal(convertQty(2, DOZEN, PCS), '24');
  assert.equal(convertQty(6, PCS, DOZEN), '0.5');
});

test('uom: incompatible units are refused, never guessed', () => {
  assert.equal(areCompatible(L, KG), false);
  assert.throws(() => convertQty(1, L, KG), IncompatibleUomError);
  assert.throws(() => convertQty(1, PCS, KG), IncompatibleUomError);
});

test('uom: conversion round-trips without drift', () => {
  const grams = convertQty(convertQty(0.185, KG, G), G, KG);
  assert.equal(grams, '0.185');
});

test('uom: result respects the 4dp precision of the quantity columns', () => {
  // 1 g in kg is 0.001; a third of a gram would exceed what the column can hold.
  assert.equal(convertQty(1, G, KG), '0.001');
  assert.equal(convertQty(0.5, G, KG), '0.0005');
});

// ─── CSV ─────────────────────────────────────────────────────────────────────
// These exist because the files this reads will be exported from Excel by someone who
// has never heard of RFC 4180.

test('csv: quoted fields, embedded commas and doubled quotes', () => {
  const rows = parseCsvLines('a,b\n"one, two","he said ""hi"""');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['one, two', 'he said "hi"'],
  ]);
});

test('csv: Windows line endings and the BOM Excel adds', () => {
  const rows = parseCsvLines('\ufeffsku,name\r\nRICE,Sona Masoori\r\n');
  assert.deepEqual(rows, [
    ['sku', 'name'],
    ['RICE', 'Sona Masoori'],
  ]);
});

test('csv: newlines inside a quoted field do not end the row', () => {
  const rows = parseCsvLines('name,notes\nDal,"buy weekly\nfrom kirana"');
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.[1], 'buy weekly\nfrom kirana');
});

test('csv: headers match regardless of case, spaces or underscores', () => {
  const result = parseCsv('SKU,Reorder Point\nRICE,5', {
    required: ['sku', 'reorderPoint'],
  });
  assert.deepEqual(result.missingHeaders, []);
  assert.equal(result.rows[0]?.sku, 'RICE');
  assert.equal(result.rows[0]?.reorderPoint, '5');
});

test('csv: missing and unknown headers are reported, not guessed at', () => {
  const result = parseCsv('sku,colour\nRICE,white', { required: ['sku', 'name'] });
  assert.deepEqual(result.missingHeaders, ['name']);
  assert.deepEqual(result.unknownHeaders, ['colour']);
});

test('csv: blank trailing rows are dropped', () => {
  const result = parseCsv('sku\nRICE\n\n', { required: ['sku'] });
  assert.equal(result.rows.length, 1);
});

test('csv: money is read the way people type it', () => {
  assert.equal(csvMoneyMinor('120'), 12000);
  assert.equal(csvMoneyMinor('120.50'), 12050);
  assert.equal(csvMoneyMinor('₹1,200'), 120000);
  assert.equal(csvMoneyMinor(''), null);
  assert.equal(csvMoneyMinor('abc'), null);
});

test('csv: dates accept the DD/MM/YYYY Indian spreadsheets default to', () => {
  assert.equal(csvDate('2026-10-15'), '2026-10-15');
  assert.equal(csvDate('15/10/2026'), '2026-10-15');
  assert.equal(csvDate('5/1/2026'), '2026-01-05');
  assert.equal(csvDate('nonsense'), null);
});

test('csv: booleans and enums are matched loosely', () => {
  assert.equal(csvBool('yes'), true);
  assert.equal(csvBool('TRUE'), true);
  assert.equal(csvBool(''), false);
  assert.equal(csvEnum('non veg', ['VEG', 'NON_VEG'] as const), 'NON_VEG');
  assert.equal(csvEnum('vEg', ['VEG', 'NON_VEG'] as const), 'VEG');
  assert.equal(csvEnum('fish', ['VEG', 'NON_VEG'] as const), null);
});

test('csv: round-trips through toCsv', () => {
  const text = toCsv(['name', 'notes'], [['Dal, toor', 'said "buy"']]);
  const back = parseCsvLines(text);
  assert.deepEqual(back[1], ['Dal, toor', 'said "buy"']);
});
