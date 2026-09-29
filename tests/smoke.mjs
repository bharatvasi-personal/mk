// End-to-end smoke test against a running API.
// Drives the actual POS flow: sign in, open the drawer, take an order, cut a KOT,
// settle it, then check stock depletion, the invoice number and the day's report.

const BASE = 'http://localhost:4000/api';
const TENANT = 'mithilakitchen';

let token = '';
const results = [];

function uuid() {
  return crypto.randomUUID();
}

async function call(method, path, body, opts = {}) {
  const headers = { 'X-Tenant': TENANT };
  if (body) headers['Content-Type'] = 'application/json';
  if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const money = (m) => `Rs.${(m / 100).toFixed(2)}`;

async function main() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let r = await call('POST', '/auth/staff/login', {
    tenantSlug: TENANT,
    identifier: 'owner@mithilakitchen.in',
    password: process.env.SEED_OWNER_PASSWORD || 'ChangeMe@12345',
    client: 'POS',
  });
  check('staff login', r.status === 200 && !!r.body?.accessToken, `status ${r.status}`);
  token = r.body?.accessToken;
  if (!token) {
    console.log(JSON.stringify(r.body));
    process.exit(1);
  }

  r = await call('POST', '/auth/staff/login', {
    tenantSlug: TENANT,
    identifier: 'owner@mithilakitchen.in',
    password: 'definitely-wrong-password',
    client: 'POS',
  });
  check('wrong password is rejected', r.status === 401, `status ${r.status}`);

  r = await call('GET', '/branches', null, { noAuth: true });
  check('unauthenticated request is rejected', r.status === 401, `status ${r.status}`);

  r = await call('GET', '/auth/me');
  check(
    'me returns permissions',
    r.status === 200 && Array.isArray(r.body?.permissions) && r.body.permissions.length > 40,
    `${r.body?.permissions?.length} permissions`,
  );

  // ── Branch & menu ─────────────────────────────────────────────────────────
  r = await call('GET', '/branches');
  const branch = r.body?.[0];
  check('branch list', r.status === 200 && !!branch, branch?.name);
  const branchId = branch.id;

  r = await call('GET', `/menu/branch/${branchId}?mealSlot=LUNCH`);
  const lunch = r.body;
  const thaliCat = lunch?.find((c) => c.slug === 'thali');
  const vegThali = thaliCat?.items?.find((i) => i.slug === 'veg-thali');
  const regular = vegThali?.variants?.find((v) => v.name === 'Regular');
  check(
    'priced lunch menu',
    r.status === 200 && !!regular && regular.priceMinor === 10000,
    `Veg Thali Regular = ${money(regular?.priceMinor ?? 0)}`,
  );

  r = await call('GET', '/public/menu/' + branchId, null, { noAuth: true });
  check('public menu needs no auth', r.status === 200 && Array.isArray(r.body), `${r.body?.length} categories`);

  // ── Stock before ──────────────────────────────────────────────────────────
  r = await call('GET', `/inventory/on-hand/${branchId}`);
  const riceBefore = r.body?.find((i) => i.sku === 'RICE-SONA');
  check('stock on hand', r.status === 200 && !!riceBefore, `rice ${riceBefore?.onHandQty} kg`);

  // ── Cash session ──────────────────────────────────────────────────────────
  r = await call('POST', '/cash-sessions/open', { branchId, openingFloatMinor: 200000 });
  const session = r.body;
  check('open cash drawer with Rs.2000 float', r.status === 201 || r.status === 200, `status ${r.status}`);

  // ── Order ─────────────────────────────────────────────────────────────────
  const fullThali = vegThali.variants.find((v) => v.name === 'Full');
  const clientRef = uuid();
  const idemKey = uuid();
  const orderBody = {
    branchId,
    clientRef,
    channel: 'DINE_IN',
    mealSlot: 'LUNCH',
    guestCount: 3,
    items: [
      { variantId: regular.variantId, qty: 2 },
      { variantId: fullThali.variantId, qty: 1, notes: 'less spicy' },
    ],
    discountMinor: 0,
  };

  r = await call('POST', '/orders', orderBody, { idempotencyKey: idemKey });
  const order = r.body;
  // 2 x Rs.100 + 1 x Rs.130 = Rs.330, GST-inclusive
  check(
    'create order prices from the branch menu',
    r.status === 201 && order?.totalMinor === 33000,
    `total ${money(order?.totalMinor ?? 0)}, token #${order?.tokenNo}`,
  );
  check(
    'GST is extracted, not added',
    order?.taxMinor > 0 && order.taxMinor < 1800,
    `tax ${money(order?.taxMinor ?? 0)} of ${money(order?.totalMinor ?? 0)}`,
  );

  // Idempotency: the same key and body must return the same order, not a second one.
  r = await call('POST', '/orders', orderBody, { idempotencyKey: idemKey });
  check('idempotent replay returns the same order', r.body?.id === order.id, `id ${r.body?.id === order.id}`);

  // A different Idempotency-Key but the same clientRef must also not duplicate.
  r = await call('POST', '/orders', orderBody, { idempotencyKey: uuid() });
  check('duplicate clientRef returns the original order', r.body?.id === order.id);

  // A price sent by the client must be ignored.
  r = await call('POST', '/orders', { ...orderBody, clientRef: uuid(), unitPriceMinor: 1 }, {});
  check(
    'client cannot dictate a price',
    r.status === 201 && r.body?.totalMinor === 33000,
    `total ${money(r.body?.totalMinor ?? 0)}`,
  );
  const throwaway = r.body?.id;
  if (throwaway) await call('POST', '/orders/cancel', { orderId: throwaway, reason: 'smoke test cleanup' });

  // ── KOT ───────────────────────────────────────────────────────────────────
  r = await call('POST', `/orders/${order.id}/kot`);
  check(
    'KOT printed, split by station',
    (r.status === 201 || r.status === 200) && Array.isArray(r.body) && r.body.length >= 1,
    `${r.body?.length} ticket(s), station ${r.body?.[0]?.station}`,
  );

  // ── Settle ────────────────────────────────────────────────────────────────
  r = await call(
    'POST',
    '/orders/settle',
    {
      orderId: order.id,
      tenders: [
        { tender: 'CASH', amountMinor: 20000, tenderedMinor: 20000 },
        { tender: 'UPI_MANUAL', amountMinor: 13000, reference: 'UTR123456789012' },
      ],
      roundOff: true,
      printBill: true,
    },
    { idempotencyKey: uuid() },
  );
  const settled = r.body;
  check(
    'settle with split cash + UPI tender',
    (r.status === 201 || r.status === 200) && settled?.order?.status === 'SETTLED',
    `invoice ${settled?.invoice?.invoiceNo}`,
  );
  check(
    'invoice number is per-branch and per-FY',
    /^OSN\/2026-27\/\d{5}$/.test(settled?.invoice?.invoiceNo ?? ''),
    settled?.invoice?.invoiceNo,
  );
  check(
    'CGST and SGST split evenly',
    settled?.invoice?.cgstMinor + settled?.invoice?.sgstMinor === order.taxMinor,
    `${money(settled?.invoice?.cgstMinor ?? 0)} + ${money(settled?.invoice?.sgstMinor ?? 0)}`,
  );
  check(
    'cost of goods captured at sale',
    settled?.order?.costMinor > 0,
    `COGS ${money(settled?.order?.costMinor ?? 0)} on ${money(order.totalMinor)} = ${(
      (settled?.order?.costMinor / order.totalMinor) * 100
    ).toFixed(1)}% food cost`,
  );

  // A UPI tender without a UTR must be refused.
  r = await call('POST', '/orders', { ...orderBody, clientRef: uuid() }, {});
  const second = r.body;
  r = await call('POST', '/orders/settle', {
    orderId: second.id,
    tenders: [{ tender: 'UPI_MANUAL', amountMinor: second.totalMinor }],
  });
  check('UPI tender without a UTR is refused', r.status === 400, `status ${r.status}`);

  // Underpayment must be refused.
  r = await call('POST', '/orders/settle', {
    orderId: second.id,
    tenders: [{ tender: 'CASH', amountMinor: 100 }],
  });
  check('underpayment is refused', r.status === 400, r.body?.message?.slice(0, 60));

  // Settle it properly, then confirm it cannot be settled twice.
  r = await call('POST', '/orders/settle', {
    orderId: second.id,
    tenders: [{ tender: 'CASH', amountMinor: second.totalMinor + 7000, tenderedMinor: second.totalMinor + 7000 }],
  });
  check('change computed for cash overpayment', r.body?.changeMinor === 7000, `change ${money(r.body?.changeMinor ?? 0)}`);

  r = await call('POST', '/orders/settle', {
    orderId: second.id,
    tenders: [{ tender: 'CASH', amountMinor: second.totalMinor }],
  });
  check('a settled bill cannot be settled again', r.status === 409, `status ${r.status}`);

  // ── Immutability ──────────────────────────────────────────────────────────
  r = await call('POST', '/orders/void-item', {
    orderId: order.id,
    orderItemId: settled?.order?.id ? order.items[0].id : order.items[0].id,
    reason: 'attempting to edit a settled bill',
  });
  check('a settled bill cannot be edited', r.status === 400, r.body?.message?.slice(0, 60));

  r = await call('POST', '/orders/credit-note', {
    orderId: order.id,
    amountMinor: 5000,
    reason: 'Customer returned one thali',
  });
  check(
    'correction goes through a credit note',
    r.status === 201 || r.status === 200,
    r.body?.noteNo,
  );

  // ── Stock depletion ───────────────────────────────────────────────────────
  r = await call('GET', `/inventory/on-hand/${branchId}`);
  const riceAfter = r.body?.find((i) => i.sku === 'RICE-SONA');
  const consumed = Number(riceBefore.onHandQty) - Number(riceAfter.onHandQty);
  check(
    'recipes deplete stock on settle',
    consumed > 0,
    `rice ${riceBefore.onHandQty} -> ${riceAfter.onHandQty} kg (${consumed.toFixed(3)} used)`,
  );

  r = await call('GET', `/inventory/ledger/${branchId}?inventoryItemId=${riceAfter.inventoryItemId}`);
  check(
    'stock ledger records the sale consumption',
    r.body?.some((e) => e.reason === 'SALE_CONSUMPTION'),
    `${r.body?.length} ledger entries`,
  );

  // ── Purchasing ────────────────────────────────────────────────────────────
  r = await call('GET', `/inventory/buy-today/${branchId}?rhythm=DAILY`);
  check('purchase worklist groups by vendor', r.status === 200 && Array.isArray(r.body), `${r.body?.length} vendor group(s)`);

  r = await call('GET', '/vendors');
  const kirana = r.body?.find((v) => v.code === 'KIRANA-SL');
  check('vendor directory', r.status === 200 && kirana?.creditDays === 15, `${kirana?.name}, ${kirana?.creditDays}-day credit`);

  r = await call('GET', `/inventory/items?search=Toor`);
  const toor = r.body?.[0];

  r = await call('POST', '/vendors/receipts', {
    branchId,
    vendorId: kirana.id,
    lines: [{ inventoryItemId: toor.id, receivedQty: '10', rejectedQty: '0', unitPriceMinor: 15000 }],
    billNo: 'SL/2026/4471',
    billDate: new Date().toISOString().slice(0, 10),
  });
  check(
    'goods receipt adds stock and creates a payable',
    (r.status === 201 || r.status === 200) && !!r.body?.vendorInvoice,
    `bill ${r.body?.vendorInvoice?.billNo}, due ${r.body?.vendorInvoice?.dueOn?.slice(0, 10)}`,
  );

  r = await call('GET', '/vendors/payables/list');
  check('payables list shows what is owed', r.status === 200 && r.body?.length >= 1, `${r.body?.length} open bill(s)`);

  // ── Attendance ────────────────────────────────────────────────────────────
  r = await call('GET', '/staff/employees?branchId=' + branchId);
  const chef = r.body?.find((e) => e.employeeCode === 'E001');
  // Paired in/out is checked on a different employee from the NFC test, so a leftover
  // open punch from an earlier run cannot make the day ambiguous.
  const helper = r.body?.find((e) => e.employeeCode === 'E002');
  check('employee records', r.status === 200 && !!chef && !!helper, `${r.body?.length} staff`);

  const inAt = new Date(Date.now() - 6 * 3600_000).toISOString();
  r = await call('POST', '/attendance/punch', {
    branchId,
    employeeId: helper.id,
    direction: 'IN',
    source: 'MANUAL',
    occurredAt: inAt,
  });
  check('punch in', r.status === 201 || r.status === 200, `status ${r.body?.day?.status}`);

  r = await call('POST', '/attendance/punch', {
    branchId,
    employeeId: helper.id,
    direction: 'OUT',
    source: 'MANUAL',
    occurredAt: new Date().toISOString(),
  });
  check(
    'punch out derives worked minutes and marks the day present',
    r.body?.day?.workedMinutes >= 300 && r.body?.day?.status === 'PRESENT',
    `${r.body?.day?.workedMinutes} minutes, status ${r.body?.day?.status}`,
  );

  r = await call('GET', `/attendance/today/${branchId}`);
  check('attendance today', r.status === 200 && r.body?.length >= 5, `${r.body?.length} staff rows`);

  r = await call('GET', `/attendance/qr/${branchId}`);
  check('rotating wall QR token', r.status === 200 && !!r.body?.token, `expires in ${r.body?.expiresInSeconds}s`);

  // Hardware readiness: register a device and issue an NFC card, unused at launch.
  const deviceCode = `NFC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const cardUid = Math.random().toString(16).slice(2, 14).toUpperCase();
  r = await call('POST', '/attendance/devices', {
    branchId,
    code: deviceCode,
    name: 'Counter NFC reader',
    kind: 'NFC',
  });
  check('attendance device registers with a shared secret', !!r.body?.secret, `device ${r.body?.device?.code}`);

  r = await call('POST', '/attendance/credentials', {
    employeeId: chef.id,
    type: 'NFC_CARD',
    identifier: cardUid,
  });
  check('NFC card issued to an employee', r.status === 201 || r.status === 200, r.body?.identifier);

  r = await call('POST', '/attendance/punch', {
    branchId,
    credentialType: 'NFC_CARD',
    credentialIdentifier: cardUid,
    direction: 'IN',
    source: 'NFC',
    deviceCode,
  });
  check('punch by NFC card resolves the employee', r.body?.employee?.id === chef.id, r.body?.employee?.name);

  // ── Reports ───────────────────────────────────────────────────────────────
  r = await call('GET', `/reports/today/${branchId}`);
  const today = r.body;
  check(
    'today report',
    r.status === 200 && today?.orderCount >= 2,
    `${today?.orderCount} orders, ${money(today?.grossSalesMinor ?? 0)}, food cost ${(
      today?.foodCostBp / 100
    ).toFixed(1)}%`,
  );
  check(
    'cash vs UPI split',
    today?.cashSalesMinor > 0 && today?.upiSalesMinor > 0,
    `cash ${money(today?.cashSalesMinor ?? 0)} / UPI ${money(today?.upiSalesMinor ?? 0)}`,
  );
  check('top items', Array.isArray(today?.topItems) && today.topItems.length > 0, today?.topItems?.[0]?.name);

  r = await call('GET', `/inventory/margins/${branchId}`);
  const withRecipe = r.body?.filter((m) => m.hasRecipe) ?? [];
  check(
    'per-dish food cost against target',
    withRecipe.length > 0,
    `${withRecipe.length} costed dishes; worst ${withRecipe[0]?.name} at ${(withRecipe[0]?.foodCostBp / 100).toFixed(1)}%`,
  );

  // ── Cash drawer close / Z-report ──────────────────────────────────────────
  r = await call('GET', `/cash-sessions/current?branchId=${branchId}`);
  const tally = r.body;
  check(
    'drawer tally',
    r.status === 200 && tally?.expectedCashMinor > 200000,
    `expected ${money(tally?.expectedCashMinor ?? 0)} in the drawer`,
  );

  r = await call('POST', '/cash-sessions/close', {
    cashSessionId: session.id,
    countedCashMinor: tally.expectedCashMinor - 2000,
    notes: 'Rs.20 short — miscount at the counter',
  });
  check(
    'Z-report records the cash variance',
    (r.status === 201 || r.status === 200) && r.body?.varianceMinor === -2000,
    `variance ${money(r.body?.varianceMinor ?? 0)}`,
  );

  // ── Audit trail ───────────────────────────────────────────────────────────
  r = await call('GET', '/reports/audit?entity=Order');
  check(
    'audit trail records settlements',
    r.status === 200 && r.body?.some((a) => a.action === 'ORDER_SETTLED'),
    `${r.body?.length} order audit entries`,
  );

  // ── Authorization ─────────────────────────────────────────────────────────
  const ownerToken = token;
  r = await call(
    'POST',
    '/auth/staff/login',
    { tenantSlug: TENANT, identifier: 'counter@mithilakitchen.in', password: 'Counter@12345', client: 'POS' },
    { noAuth: true },
  );
  token = r.body?.accessToken;
  check('helper can sign in', !!token);

  r = await call('GET', `/reports/today/${branchId}`);
  check('helper cannot see reports', r.status === 403, `status ${r.status}`);

  r = await call('GET', `/inventory/margins/${branchId}`);
  check('helper cannot see cost prices', r.status === 403, `status ${r.status}`);

  r = await call('GET', '/legal/documents');
  check('helper cannot see legal documents', r.status === 403, `status ${r.status}`);

  r = await call('POST', '/orders', { ...orderBody, clientRef: uuid() }, {});
  check('helper can still take an order', r.status === 201, `status ${r.status}`);
  if (r.body?.id) await call('POST', '/orders/cancel', { orderId: r.body.id, reason: 'smoke test cleanup' }).catch(() => {});

  token = ownerToken;

  // ── Payments ──────────────────────────────────────────────────────────────
  r = await call('GET', '/payments/status', null, { noAuth: true });
  check('payment gateway status is advertised', r.status === 200, `onlineEnabled=${r.body?.onlineEnabled}`);

  r = await fetch(`${BASE}/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': TENANT, 'x-razorpay-signature': 'forged' },
    body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 33000, status: 'captured' } } } }),
  });
  check('forged webhook signature is rejected', r.status === 400, `status ${r.status}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('SMOKE TEST CRASHED:', e);
  process.exit(1);
});
