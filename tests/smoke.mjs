// End-to-end smoke test against a running API.
// Drives the actual POS flow: sign in, open the drawer, take an order, cut a KOT,
// settle it, then check stock depletion, the invoice number and the day's report.

const BASE = process.env.MK_E2E_BASE ?? 'http://localhost:4000/api';
const TENANT = process.env.MK_E2E_TENANT ?? 'mithilakitchen';

/*
 * THIS SUITE WRITES REAL DATA.
 *
 * It signs in, opens a cash drawer, settles bills, depletes stock, creates vendors,
 * employees and menu items, and issues credit notes. Every one of those is a genuine
 * record in whatever database it is pointed at — there is no rollback.
 *
 * So it refuses to run against anything but a local API unless explicitly forced. The
 * failure it is guarding against is someone running `make test-e2e` with a production
 * connection string exported, and finding a "Test Traders" vendor and an "Imported Dish"
 * on the live public menu afterwards.
 */
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(BASE);
if (!isLocal && process.env.MK_E2E_ALLOW_REMOTE !== 'yes') {
  console.error(
    `\nRefusing to run against ${BASE}.\n\n` +
      'This suite creates orders, moves stock and creates master data that cannot be\n' +
      'rolled back. Point it at a disposable database. If you genuinely mean to run it\n' +
      'against a remote environment, set MK_E2E_ALLOW_REMOTE=yes.\n',
  );
  process.exit(2);
}

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
  // Backs off on 429. The suite's own rate-limit test sprays the login endpoint, which
  // leaves the bucket for this IP exhausted for the rest of the window — so two runs
  // back to back would otherwise fail on the second one's first assertion, for a reason
  // that is the protection working rather than anything being broken.
  let r;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    r = await call('POST', '/auth/staff/login', {
      tenantSlug: TENANT,
      identifier: 'owner@mithilakitchen.in',
      password: process.env.SEED_OWNER_PASSWORD || 'ChangeMe@12345',
      client: 'POS',
    });
    if (r.status !== 429) break;
    const wait = Math.min(r.body?.retryAfterSeconds ?? 5, 10);
    if (attempt === 0) console.log(`  (rate limited from a previous run — waiting ${wait}s)`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
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
  const thaliCat = lunch?.find((c) => c.slug === 'ghar-ki-thali');
  const vegThali = thaliCat?.items?.find((i) => i.slug === 'ghar-ki-thali-veg-roti-thali');
  const nonVegThali = thaliCat?.items?.find((i) => i.slug === 'ghar-ki-thali-non-veg-roti-thali');
  const regular = vegThali?.variants?.find((v) => v.name === 'Regular');
  check(
    'priced lunch menu',
    r.status === 200 && !!regular && regular.priceMinor === 9900,
    `Ghar ki Thali (Veg) Roti = ${money(regular?.priceMinor ?? 0)}`,
  );

  r = await call('GET', '/public/menu/' + branchId, null, { noAuth: true });
  check('public menu needs no auth', r.status === 200 && Array.isArray(r.body), `${r.body?.length} categories`);

  // ── Stock before ──────────────────────────────────────────────────────────
  r = await call('GET', `/inventory/on-hand/${branchId}`);
  const riceBefore = r.body?.find((i) => i.sku === 'RICE-SONA');
  check('stock on hand', r.status === 200 && !!riceBefore, `rice ${riceBefore?.onHandQty} kg`);

  // ── Cash session ──────────────────────────────────────────────────────────
  // A drawer left open by an earlier crashed run is not a failure — this suite writes real
  // data with no rollback, so it has to be able to pick up a database it half-used before.
  // Without this, one crash turns every later cash assertion into a false failure.
  r = await call('POST', '/cash-sessions/open', { branchId, openingFloatMinor: 200000 });
  let session = r.body;
  let drawerNote = `status ${r.status}`;
  if (r.status === 400) {
    const current = await call('GET', `/cash-sessions/current?branchId=${branchId}`);
    session = current.body;
    drawerNote = `reused the drawer left open by an earlier run`;
  }
  check('open cash drawer with Rs.2000 float', !!session?.id, drawerNote);

  // ── Order ─────────────────────────────────────────────────────────────────
  const nonVeg = nonVegThali.variants.find((v) => v.name === 'Regular');
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
      { variantId: nonVeg.variantId, qty: 1, notes: 'less spicy' },
    ],
    discountMinor: 0,
  };

  r = await call('POST', '/orders', orderBody, { idempotencyKey: idemKey });
  const order = r.body;
  // 2 x Rs.99 veg + 1 x Rs.149 non-veg = Rs.347, GST-inclusive
  check(
    'create order prices from the branch menu',
    r.status === 201 && order?.totalMinor === 34700,
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
    r.status === 201 && r.body?.totalMinor === 34700,
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
        { tender: 'UPI_MANUAL', amountMinor: 14700, reference: 'UTR123456789012' },
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
  check(
    'credit notes have their own gapless, per-branch, per-FY series',
    /^CN\/OSN\/2026-27\/\d{5}$/.test(r.body?.noteNo ?? ''),
    r.body?.noteNo,
  );

  // Two credit notes in a row must not collide. The previous implementation numbered
  // them with count()+1, which two concurrent issuers resolve to the same value.
  const firstNote = r.body?.noteNo;
  r = await call('POST', '/orders/credit-note', {
    orderId: order.id,
    amountMinor: 1000,
    reason: 'Second correction on the same bill',
  });
  check(
    'a second credit note gets the next number, not a duplicate',
    r.body?.noteNo && r.body.noteNo !== firstNote,
    `${firstNote} then ${r.body?.noteNo}`,
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

  // ── Unit conversion ───────────────────────────────────────────────────────
  // A recipe written in grams against an item stocked in kilograms must convert, not
  // deduct 180 kg of paneer for a 180 g line.
  r = await call('GET', '/inventory/uoms');
  const gram = r.body?.find((u) => u.code === 'g');
  const kilo = r.body?.find((u) => u.code === 'kg');
  check('units of measure are defined with conversion factors', !!gram && !!kilo, `g -> ${gram?.baseCode}`);

  r = await call('GET', '/inventory/items?search=Paneer');
  const paneer = r.body?.[0];

  r = await call('GET', `/menu/branch/${branchId}?mealSlot=EVENING`);
  const gobi = r.body?.flatMap((c) => c.items).find((i) => i.slug === 'gobi-manchurian');
  const gobiVariant = gobi?.variants?.[0];

  if (paneer && gobiVariant && gram) {
    r = await call('POST', '/inventory/recipes', {
      menuItemId: gobi.id,
      variantId: gobiVariant.variantId,
      yieldQty: '1',
      lines: [{ inventoryItemId: paneer.id, qty: '180', uomId: gram.id, wastagePct: 0, isOptional: false }],
    });
    check('a recipe can be written in grams for a kg-stocked item', r.status === 201 || r.status === 200);

    r = await call('GET', `/inventory/margins/${branchId}`);
    const gobiMargin = r.body?.find((m) => m.menuItemId === gobi.id);
    // 180 g of paneer at Rs.340/kg is Rs.61.20, not Rs.61,200.
    check(
      'grams are converted before costing, not treated as kilograms',
      gobiMargin?.costMinor > 5000 && gobiMargin?.costMinor < 8000,
      `cost ${money(gobiMargin?.costMinor ?? 0)} for 180g of paneer at Rs.340/kg`,
    );

    // An impossible conversion must be refused at save time, not guessed at.
    const litre = (await call('GET', '/inventory/uoms')).body?.find((u) => u.code === 'L');
    r = await call('POST', '/inventory/recipes', {
      menuItemId: gobi.id,
      variantId: gobiVariant.variantId,
      yieldQty: '1',
      lines: [{ inventoryItemId: paneer.id, qty: '1', uomId: litre.id, wastagePct: 0, isOptional: false }],
    });
    check('a recipe in litres for a kg item is refused', r.status === 400, r.body?.errors?.[0]?.message);
  }

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

  // ── Bulk import ───────────────────────────────────────────────────────────
  r = await call('GET', '/import/entities');
  check('import entities are described', Array.isArray(r.body) && r.body.length === 4, r.body?.map((e) => e.entity).join(', '));

  r = await call('GET', '/import/vendors/template');
  const template = typeof r.body?.raw === 'string' ? r.body.raw : JSON.stringify(r.body);
  check('a CSV template is downloadable', template.includes('code') && template.includes('creditDays'));

  const stamp = Math.random().toString(36).slice(2, 7).toUpperCase();

  // A file with one good row and one broken one must report the broken one and change
  // nothing at all.
  const badCsv = [
    'code,name,phone,creditDays,category',
    `IMP-${stamp}-A,Test Traders A,9000090001,10,Groceries`,
    `IMP-${stamp}-B,,9000090002,999,Groceries`,
  ].join('\n');

  r = await call('POST', '/import/vendors/preview', { branchId, csv: badCsv });
  check(
    'preview reports every bad row without changing anything',
    r.body?.errorCount === 1 && r.body?.createCount === 1,
    `${r.body?.createCount} ok, ${r.body?.errorCount} bad`,
  );

  r = await call('POST', '/import/vendors/commit', { branchId, csv: badCsv });
  check('a file with errors is refused wholesale', r.status === 400, r.body?.message?.slice(0, 50));

  r = await call('GET', `/vendors?search=IMP-${stamp}`);
  check('nothing was written from the refused file', (r.body?.length ?? 0) === 0, `${r.body?.length ?? 0} vendors`);

  // The corrected file imports cleanly.
  const goodCsv = [
    'Code,Name,Phone,Credit Days,Category',
    `IMP-${stamp}-A,Test Traders A,9000090001,10,Groceries`,
    `IMP-${stamp}-B,Test Traders B,9000090002,7,Vegetables`,
  ].join('\r\n');

  r = await call('POST', '/import/vendors/commit', { branchId, csv: goodCsv });
  check(
    'a clean file imports, and loose header names are matched',
    r.body?.createCount === 2 && r.body?.errorCount === 0,
    `${r.body?.createCount} created`,
  );

  r = await call('GET', `/vendors?search=IMP-${stamp}`);
  check('imported vendors exist with their credit terms', r.body?.length === 2, `${r.body?.[0]?.name}, ${r.body?.[0]?.creditDays}d`);

  // Re-importing the same file updates rather than duplicating — "fix it and send it
  // again" has to be safe.
  r = await call('POST', '/import/vendors/commit', { branchId, csv: goodCsv });
  check('re-importing updates instead of duplicating', r.body?.updateCount === 2 && r.body?.createCount === 0);

  // Menu import, including a price and a Hindi name.
  const menuCsv = [
    'category,item,itemHi,variant,mealSlot,price,foodType,isLessOil',
    `Test Imports,Imported Dish ${stamp},आयातित व्यंजन,Regular,LUNCH,95,VEG,yes`,
  ].join('\n');
  r = await call('POST', '/import/menu/commit', { branchId, csv: menuCsv });
  check('menu import creates a priced item', r.body?.createCount === 1, `${r.body?.createCount} created`);

  r = await call('GET', `/menu/branch/${branchId}?mealSlot=LUNCH`);
  const importedCat = r.body?.find((c) => c.slug === 'test-imports');
  check(
    'the imported dish is priced on the branch menu',
    importedCat?.items?.[0]?.variants?.[0]?.priceMinor === 9500,
    `${importedCat?.items?.[0]?.name} at ${money(importedCat?.items?.[0]?.variants?.[0]?.priceMinor ?? 0)}`,
  );

  // A helper must not be able to bulk-create staff.
  const ownerTokenForImport = token;
  r = await call(
    'POST',
    '/auth/staff/login',
    { tenantSlug: TENANT, identifier: 'counter@mithilakitchen.in', password: 'Counter@12345', client: 'POS' },
    { noAuth: true },
  );
  token = r.body?.accessToken;
  r = await call('POST', '/import/employees/preview', { branchId, csv: 'employeeCode,name,roleType,joinedOn\nX1,X,HELPER,2026-10-01' });
  check('a helper cannot bulk-import staff', r.status === 403, `status ${r.status}`);
  token = ownerTokenForImport;

  // ── Attendance ────────────────────────────────────────────────────────────
  r = await call('GET', '/staff/employees?branchId=' + branchId);
  const chef = r.body?.find((e) => e.employeeCode === 'E001');
  check('employee records', r.status === 200 && !!chef, `${r.body?.length} staff`);

  // Paired in/out is checked on an employee this run creates. Re-running against the same
  // database would otherwise stack two punch-ins on one day — which the system correctly
  // flags for review, but which says nothing about whether the pairing logic works.
  const tempCode = `T${Date.now().toString(36).toUpperCase().slice(-6)}`;
  r = await call('POST', '/staff/employees', {
    branchId,
    employeeCode: tempCode,
    name: `Smoke Test ${tempCode}`,
    roleType: 'HELPER',
    employmentType: 'DAILY_WAGE',
    joinedOn: new Date().toISOString().slice(0, 10),
  });
  const helper = r.body;
  check('create an employee', r.status === 201 && !!helper?.id, tempCode);

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

  // ── Taking a dish variant off the menu and putting it back ────────────────
  //
  // Removing a variant deactivates it rather than deleting it, so it keeps holding the
  // (menuItemId, name) pair. The dish editor has no id for a name it is re-adding, so the
  // create collided with that constraint and the screen answered "That record already
  // exists" for a dish the kitchen was simply putting back on.
  {
    const cat = (await call('GET', '/menu/categories')).body?.[0];
    const stamp = uuid().slice(0, 6).toUpperCase();
    const dish = (variantList) => ({
      categoryId: cat.id,
      name: `Smoke Variant ${stamp}`,
      nameI18n: {},
      descriptionI18n: {},
      foodType: 'VEG',
      isLessOil: false,
      isMithilaSpecial: false,
      isChefSpecial: false,
      allergens: [],
      sortOrder: 0,
      isActive: true,
      variants: variantList,
    });

    r = await call(
      'POST',
      '/menu/items',
      dish([
        { name: 'Regular', nameI18n: {}, isDefault: true, sortOrder: 0 },
        { name: 'Full', nameI18n: {}, isDefault: false, sortOrder: 1 },
      ]),
    );
    const dishId = r.body?.id;
    const regularId = r.body?.variants?.find((v) => v.name === 'Regular')?.id;
    const keepRegular = [{ id: regularId, name: 'Regular', nameI18n: {}, isDefault: true, sortOrder: 0 }];

    r = await call('PUT', `/menu/items/${dishId}`, dish(keepRegular));
    check('a variant can be taken off a dish', r.status === 200, `status ${r.status}`);

    r = await call(
      'PUT',
      `/menu/items/${dishId}`,
      dish([...keepRegular, { name: 'Full', nameI18n: {}, isDefault: false, sortOrder: 1 }]),
    );
    check(
      'and put back under the same name',
      r.status === 200 && r.body?.variants?.some((v) => v.name === 'Full' && v.isActive),
      `status ${r.status}`,
    );

    // Deactivated rather than deleted: order lines and recipes still point at it.
    await call('PUT', `/menu/items/${dishId}`, { ...dish(keepRegular), isActive: false });
  }

  // ── Money that comes back from raw SQL ────────────────────────────────────
  //
  // Postgres sums arrive as BigInt and JSON.stringify throws on one, so this endpoint used
  // to answer a bare 500 "Something went wrong" instead of what is owed to each vendor —
  // with the real cause visible only in the server log.
  r = await call('GET', '/vendors/payables/balances');
  check(
    'vendor balances survive JSON (BigInt sums from raw SQL)',
    r.status === 200 && Array.isArray(r.body),
    `${r.body?.length ?? 0} vendor(s) with money outstanding`,
  );

  // A required date that simply was not sent reached Prisma as `new Date(undefined)` and
  // came back as a 500. A missing parameter is the caller's mistake and must say so.
  r = await call('GET', `/reports/break-even/${branchId}`);
  check(
    'a missing date is a 400 naming the field, not a 500',
    r.status === 400 && r.body?.errors?.some((e) => e.field === 'from'),
    `status ${r.status}`,
  );
  const isoToday = new Date().toISOString().slice(0, 10);
  r = await call('GET', `/reports/break-even/${branchId}?from=${isoToday}&to=${isoToday}`);
  check('break-even report', r.status === 200, `status ${r.status}`);

  // ── Browser reachability ──────────────────────────────────────────────────
  //
  // The API's CORS default was GET,HEAD,POST, which made every PUT and PATCH endpoint
  // unreachable from a browser while remaining perfectly reachable from curl and from this
  // suite. Editing a vendor, a menu price, an employee or marking a kitchen ticket ready
  // silently did nothing, with no server-side error to find. Asserted here because no
  // other test in this file goes through a preflight.
  {
    const pre = await fetch(`${BASE}/staff/employees/00000000-0000-0000-0000-000000000000`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type,x-tenant',
      },
    });
    const allowed = (pre.headers.get('access-control-allow-methods') ?? '')
      .split(',')
      .map((m) => m.trim().toUpperCase());
    check(
      'a browser is allowed to PUT and PATCH, not only GET and POST',
      ['PUT', 'PATCH', 'DELETE'].every((m) => allowed.includes(m)),
      allowed.join(' ') || 'no allow-methods header',
    );
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────
  //
  // Managed weekly/monthly plans: the record, its lifecycle, and the daily delivery list
  // the kitchen packs against. Day-of-week, pauses and one-off skips all narrow that list.
  {
    const monday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); // the next Monday
      return d.toISOString().slice(0, 10);
    })();
    const mondayDow = new Date(`${monday}T00:00:00.000Z`).getUTCDay();

    let s = await call('POST', '/subscriptions', {
      branchId,
      customerName: 'Smoke Subscriber',
      customerPhone: '9876500000',
      plan: 'MONTHLY',
      diet: 'VEG',
      shift: 'LUNCH',
      daysOfWeek: [mondayDow],
      startDate: monday,
      amountMinor: 450000,
      area: 'Gachibowli',
    });
    check('create a subscription', s.status === 201 && s.body?.status === 'ACTIVE', `status ${s.status}`);
    const subId = s.body?.id;

    s = await call('GET', `/subscriptions/due/${branchId}?date=${monday}&shift=LUNCH`);
    check(
      'the subscriber is on that Monday’s lunch delivery list',
      s.status === 200 && s.body?.rows?.some((r2) => r2.id === subId) && s.body?.veg >= 1,
      `${s.body?.total} due, ${s.body?.veg} veg`,
    );

    // A one-off skip removes them from that day's list.
    await call('POST', `/subscriptions/${subId}/skips`, { dates: [monday] });
    s = await call('GET', `/subscriptions/due/${branchId}?date=${monday}&shift=LUNCH`);
    check('a skipped day drops them from the list', !s.body?.rows?.some((r2) => r2.id === subId), `${s.body?.total} due after skip`);

    // Clear the skip, then a dinner query must not include a lunch-only plan.
    await call('POST', `/subscriptions/${subId}/skips`, { dates: [] });
    s = await call('GET', `/subscriptions/due/${branchId}?date=${monday}&shift=DINNER`);
    check('a lunch-only plan is absent from the dinner list', !s.body?.rows?.some((r2) => r2.id === subId), `${s.body?.total} due at dinner`);

    // Pause covering that Monday also removes them.
    await call('POST', `/subscriptions/${subId}/status`, { status: 'PAUSED', pausedFrom: monday, pausedTo: monday });
    s = await call('GET', `/subscriptions/due/${branchId}?date=${monday}&shift=LUNCH`);
    check('a pause window drops them from the list', !s.body?.rows?.some((r2) => r2.id === subId), `${s.body?.total} due while paused`);

    // Mark paid, then cancel to leave the data clean.
    s = await call('POST', `/subscriptions/${subId}/paid`, { isPaid: true });
    check('a subscription can be marked paid', s.status === 201 || s.status === 200, `isPaid ${s.body?.isPaid}`);
    await call('POST', `/subscriptions/${subId}/status`, { status: 'CANCELLED' });
  }

  // ── Audit trail ───────────────────────────────────────────────────────────
  r = await call('GET', '/reports/audit?entity=Order');
  check(
    'audit trail records settlements',
    r.status === 200 && r.body?.rows?.some((a) => a.action === 'ORDER_SETTLED'),
    `${r.body?.total} order audit entries`,
  );
  check(
    'audit trail names the actor rather than a bare user id',
    r.body?.rows?.some((a) => a.user?.name || a.actorLabel),
    r.body?.rows?.[0]?.user?.name ?? r.body?.rows?.[0]?.actorLabel ?? 'none',
  );
  check(
    'audit filter dropdowns are derived from what is actually logged',
    Array.isArray(r.body?.actions) && r.body.actions.includes('ORDER_SETTLED'),
    `${r.body?.actions?.length} distinct actions`,
  );

  // Filtering by action must narrow the result, not silently ignore the parameter.
  r = await call('GET', '/reports/audit?action=ORDER_SETTLED');
  check(
    'audit trail filters by action',
    r.status === 200 && r.body?.rows?.every((a) => a.action === 'ORDER_SETTLED'),
    `${r.body?.total} settlements`,
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

  // ── Quick bill: the POS's primary operation ───────────────────────────────
  const quickRef = uuid();
  const quickBody = {
    branchId,
    clientRef: quickRef,
    channel: 'TAKEAWAY',
    mealSlot: 'LUNCH',
    items: [{ variantId: regular.variantId, qty: 1 }],
    discountMinor: 0,
    tenders: [{ tender: 'CASH', amountMinor: 10000, tenderedMinor: 10000 }],
    roundOff: true,
    sendToKitchen: true,
  };
  r = await call('POST', '/orders/quick-bill', quickBody, { idempotencyKey: uuid() });
  check(
    'quick-bill creates, cuts a KOT and settles in one call',
    (r.status === 201 || r.status === 200) && r.body?.order?.status === 'SETTLED',
    `invoice ${r.body?.invoice?.invoiceNo}`,
  );
  check('quick-bill returns a printable bill', Array.isArray(r.body?.bill?.lines), `${r.body?.bill?.lines?.length} line(s)`);

  // Replaying a settled quick-bill must return the existing bill, not charge again.
  r = await call('POST', '/orders/quick-bill', quickBody, { idempotencyKey: uuid() });
  check('replayed quick-bill returns the original bill', r.body?.replayed === true, `replayed=${r.body?.replayed}`);

  // ── Cross-branch access ───────────────────────────────────────────────────
  // The defect this covers: most endpoints that act on a record take the record's id and
  // no branch, so a guard reading the request cannot scope it. Before the fix, a manager
  // at one branch could settle, void or credit-note another branch's orders by id alone.
  const secondCode = `TST${stamp}`;
  r = await call('POST', '/branches', {
    code: secondCode,
    name: `Test Branch ${stamp}`,
    addressLine1: '1 Test Road',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    geofenceRadiusM: 100,
    operatingHours: {},
    isActive: true,
  });
  const otherBranch = r.body;
  check('create a second branch', r.status === 201 && !!otherBranch?.id, secondCode);

  if (otherBranch?.id) {
    // A manager scoped to the SECOND branch only.
    r = await call('POST', '/users', {
      name: `Branch Manager ${stamp}`,
      email: `mgr-${stamp.toLowerCase()}@example.com`,
      role: 'MANAGER',
      branchId: otherBranch.id,
    });
    const scopedLogin = r.body;
    check('create a manager scoped to that branch only', r.status === 201 && !!scopedLogin?.temporaryPassword);

    // An unsettled order at the FIRST branch for them to try to reach.
    const victimRef = uuid();
    r = await call('POST', '/orders', {
      branchId,
      clientRef: victimRef,
      channel: 'TAKEAWAY',
      mealSlot: 'LUNCH',
      items: [{ variantId: regular.variantId, qty: 1 }],
      discountMinor: 0,
    });
    const victim = r.body;

    const ownerToken2 = token;
    r = await call(
      'POST',
      '/auth/staff/login',
      {
        tenantSlug: TENANT,
        identifier: `mgr-${stamp.toLowerCase()}@example.com`,
        password: scopedLogin.temporaryPassword,
        client: 'WEB',
      },
      { noAuth: true },
    );
    token = r.body?.accessToken;
    check('the scoped manager can sign in', !!token, `status ${r.status}`);

    if (token) {
      r = await call('POST', '/orders/settle', {
        orderId: victim.id,
        tenders: [{ tender: 'CASH', amountMinor: victim.totalMinor, tenderedMinor: victim.totalMinor }],
      });
      check('cannot settle another branch’s order', r.status === 403, `status ${r.status}`);

      r = await call('GET', `/orders/${victim.id}`);
      check('cannot even read another branch’s order', r.status === 403, `status ${r.status}`);

      r = await call('POST', '/orders/cancel', { orderId: victim.id, reason: 'attempting cross-branch' });
      check('cannot cancel another branch’s order', r.status === 403, `status ${r.status}`);

      // …but is not locked out of their own branch.
      r = await call('GET', `/menu/branch/${otherBranch.id}?mealSlot=LUNCH`);
      check('the scoped manager still works at their own branch', r.status === 200, `status ${r.status}`);

      r = await call('GET', `/reports/today/${branchId}`);
      check('cannot read another branch’s takings', r.status === 403, `status ${r.status}`);
    }

    token = ownerToken2;
    await call('POST', '/orders/cancel', { orderId: victim.id, reason: 'smoke test cleanup' }).catch(() => {});

    // Close the test branch so it stops appearing in the branch picker. Branches are
    // never deleted — orders and stock reference them — so closing is the correct verb.
    await call('PUT', `/branches/${otherBranch.id}`, {
      code: otherBranch.code,
      name: otherBranch.name,
      addressLine1: otherBranch.addressLine1,
      city: otherBranch.city,
      state: otherBranch.state,
      pincode: otherBranch.pincode,
      geofenceRadiusM: 100,
      operatingHours: {},
      isActive: false,
    }).catch(() => {});
    await call('PATCH', `/users/${scopedLogin?.user?.id}/active`, { isActive: false }).catch(() => {});
  }

  // ── Payments ──────────────────────────────────────────────────────────────
  r = await call('GET', '/payments/status', null, { noAuth: true });
  check('payment gateway status is advertised', r.status === 200, `onlineEnabled=${r.body?.onlineEnabled}`);

  r = await fetch(`${BASE}/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant': TENANT, 'x-razorpay-signature': 'forged' },
    body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 33000, status: 'captured' } } } }),
  });
  check('forged webhook signature is rejected', r.status === 400, `status ${r.status}`);

  // ── Operations ────────────────────────────────────────────────────────────
  // /metrics reads through a SECURITY DEFINER aggregate because a scrape has no tenant.
  // Without that, RLS hides every row and a busy shop reports as a dead one — which is
  // exactly the alert nobody wants to be woken by.
  let raw = await fetch(`${BASE}/metrics`, { headers: { 'X-Tenant': TENANT } });
  const metrics = await raw.text();
  check('metrics are exposed without auth for scraping', raw.status === 200, `${metrics.split('\n').length} lines`);
  check('metrics report business numbers, not zeroes behind RLS', /mk_orders_settled_today [1-9]/.test(metrics), metrics.match(/mk_orders_settled_today \d+/)?.[0]);
  check('metrics include database liveness', metrics.includes('mk_database_up 1'));

  // Rate limiting on the expensive endpoint. Argon2 is deliberately slow, which is what
  // makes an unthrottled login a way to burn the CPU the counter needs at lunchtime.
  let throttled = 0;
  for (let i = 0; i < 12; i += 1) {
    const attempt = await fetch(`${BASE}/auth/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': TENANT },
      body: JSON.stringify({
        tenantSlug: TENANT,
        identifier: `spray-${Date.now()}@example.com`,
        password: 'wrong-password-here',
        client: 'WEB',
      }),
    });
    if (attempt.status === 429) throttled += 1;
  }
  check('password spraying is rate limited', throttled > 0, `${throttled} of 12 rejected with 429`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Master data has no delete endpoint by design — you cannot delete a vendor you have
  // paid or a dish you have sold. What this can do is deactivate the artefacts that are
  // publicly visible, so a development database does not end up showing "Imported Dish"
  // on the real menu. Everything else stays, clearly named, in a database that should be
  // disposable anyway.
  if (importedCat?.items?.[0]) {
    const dish = importedCat.items[0];
    r = await call('GET', `/menu/items?search=${encodeURIComponent(dish.name)}`);
    const full = r.body?.[0];
    if (full) {
      await call('PUT', `/menu/items/${full.id}`, {
        categoryId: full.categoryId,
        name: full.name,
        nameI18n: full.nameI18n ?? {},
        foodType: full.foodType,
        isActive: false,
        allergens: [],
        variants: (full.variants ?? []).map((v) => ({ id: v.id, name: v.name, nameI18n: {}, isDefault: v.isDefault, sortOrder: v.sortOrder })),
      });
    }
    r = await call('GET', '/menu/categories');
    const cat = r.body?.find((c) => c.slug === 'test-imports');
    if (cat) {
      await call('PUT', `/menu/categories/${cat.id}`, {
        name: cat.name,
        nameI18n: {},
        slug: cat.slug,
        mealSlot: cat.mealSlot,
        sortOrder: 999,
        isActive: false,
      });
    }
    r = await call('GET', `/menu/branch/${branchId}?mealSlot=LUNCH`);
    check(
      'test artefacts are hidden from the public menu again',
      !r.body?.some((c) => c.slug === 'test-imports'),
      'Test Imports category deactivated',
    );
  }

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
