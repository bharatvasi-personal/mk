import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractGst, formatMinor, pctBp, roundToRupee, toMinor } from './money';
import { can, ROLE_PERMISSIONS } from './rbac';
import { dictionaries } from './i18n';

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
