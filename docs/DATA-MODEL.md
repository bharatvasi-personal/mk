# MithilaKitchen — Data Model

Authoritative source: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) — 63 models.
This document explains the shape and the reasoning; the schema is the contract.

## Conventions

| Concern | Decision | Why |
|---|---|---|
| Money | `Int` **paise** everywhere (DB, API, UI) | `₹120.50` is `12050`. No float rounding, no `Decimal` serialisation pain across the JSON boundary, no mixed representation to convert. |
| Quantity | `Decimal(14,4)` | 2.5 kg, 0.180 kg of paneer per thali, 0.125 L. |
| Percentages | basis points (`Int`) | 5% GST = `500`; 32.5% food cost = `3250`. Same reason as money. |
| Ids | `uuid` | The POS generates ids offline. A sequential int cannot be generated client-side. |
| Dates | `timestamptz`, except business dates which are `date` | A shift crossing midnight and a "business day" are local concepts; `AttendanceDay.workDate` and `DailySummary.businessDate` are `date` in Asia/Kolkata on purpose. |
| Deletes | soft (`isActive`) for masters, never for financial rows | You cannot delete a bill. |

## 1. Tenant & branch isolation

```
Tenant ──1:N── Branch ──1:N── everything operational
   │                              (orders, stock, staff, POs, attendance)
   ├──1:N── User ──1:N── UserBranchRole ──N:1── Branch (nullable)
   ├──1:N── MenuItem  ← catalogue is tenant-level
   │            └──1:N── BranchMenuItem  ← price/availability is branch-level
   ├──1:N── InventoryItem ← definition is tenant-level
   │            └──1:N── BranchInventoryItem ← stock/reorder is branch-level
   ├──1:N── Vendor, Employee, Customer, LegalDocument, AuditLog
```

The recurring pattern — and the single most important decision in this model:

> **A master record is tenant-scoped. Its operational state is branch-scoped.**

`MenuItem` says *"Veg Thali exists, it is veg, it is a Mithila special."*
`BranchMenuItem` says *"at Osman Nagar, at LUNCH, a Full Veg Thali costs ₹120 and 60 are available today."*

That split is what makes branch #2 a data-entry exercise rather than a migration. Same for inventory:
`InventoryItem` is "Toor Dal, measured in kg"; `BranchInventoryItem` is "Osman Nagar holds 8.5 kg, reorder
at 5 kg, top up to 15 kg, buy from Sri Lakshmi Traders."

### How isolation is enforced

1. `tenant_id` non-null on every tenant-owned table; every business unique is composite on it.
2. **Postgres RLS** — `FORCE`d policies keyed on `current_setting('app.tenant_id')`. The app's DB role
   has neither `SUPERUSER` nor `BYPASSRLS`. A forgotten `where` clause returns zero rows, not a leak.
3. `TenantContext` from the verified JWT, asserted by a Prisma extension on every query.
4. `BranchScopeGuard` checks the requested `branchId` against the caller's `UserBranchRole` rows.

Cross-tenant FK references are prevented by (2); a trigger on the highest-risk parents also asserts
`child.tenant_id = parent.tenant_id`.

## 2. Menu (module 1a)

```
MenuCategory ──1:N── MenuItem ──1:N── MenuItemVariant
                        │                    │
                        └────────┬───────────┘
                                 ▼
                        BranchMenuItem (branch × variant × mealSlot → price)
```

- `MealSlot` = `LUNCH | CHAI | EVENING | ALL_DAY`, matching the actual trading pattern: thali at lunch,
  chai all day, Chinese in the evening. The same item can carry different prices in different slots.
- Every item has at least one variant (a `DEFAULT`) so the POS and pricing have exactly one code path
  rather than a nullable-variant special case.
- `nameI18n`/`descriptionI18n` JSONB hold Hindi and Telugu. A localised menu is one column, not a table.
- `soldOutUntil` and `dailyLimit` exist because a 12x18 ft kitchen genuinely runs out of thalis at 1:40 pm,
  and the online store must stop selling them.
- `targetFoodCostPct` on the item is compared against the live recipe cost to raise a margin alert.

## 3. Orders, billing, payments (module 1b)

```
Order ──1:N── OrderItem ──1:N── KitchenTicketItem ──N:1── KitchenTicket
  ├──1:N── Payment ──1:N── Refund
  ├──1:1── Invoice ──1:N── CreditNote
  ├──1:N── OrderStatusEvent        (append-only history)
  ├──N:1── CashSession             (which drawer shift took the money)
  └──1:N── StockLedgerEntry        (SALE_CONSUMPTION, from recipes)
```

Design points worth defending:

- **`clientRef` + `@@unique([branchId, clientRef])`.** The POS mints a UUID before it has a network. The
  unique constraint makes a blind retry a no-op at the database level, not just at the application level.
- **Totals are stored, not computed.** Reprinting a bill from March must show March's prices and March's
  GST rate. A view that recomputes from the current menu would silently rewrite history.
- **`costMinor` on the order and `lineCostMinor` on each line.** Food cost is captured at the moment of
  sale from the then-current weighted-average ingredient cost. This turns "what was my food cost in
  October" from a fragile reconstruction into a stored fact.
- **`Invoice` is separate from `Order` and immutable.** An order is operational and mutable while open;
  an invoice is a legal document created once at settle. `InvoiceSequence` is a row locked
  `FOR UPDATE` inside the settle transaction, giving a **gapless** per-branch per-FY number — a Postgres
  sequence would leak numbers on rollback, which a GST auditor will ask about.
- **`KitchenTicket.station`** splits the thali kitchen from the Chinese counter so each gets its own
  ticket stream and its own numbering.
- **`TenderType.UPI_MANUAL`** is a first-class tender, not a workaround. Most walk-in UPI will go to the
  shop's static QR at zero MDR; the POS records the amount and the UTR. Routing counter sales through a
  gateway to get "cleaner data" would cost real money for no operational gain.
- **`CashSession`** with opening float, expected cash, counted cash and denomination breakdown. The
  variance is the number that catches till errors and pilferage.

## 4. Inventory & recipes (modules 2 and 4)

```
InventoryItem ──1:N── BranchInventoryItem      (on-hand cache, reorder point, par level)
      │         ──1:N── StockLedgerEntry       ← THE TRUTH (append-only)
      │         ──1:N── RecipeLine ──N:1── Recipe ──N:1── MenuItem/Variant
      │         ──1:N── VendorItemPrice
      │         ──1:N── StockCountLine ──N:1── StockCount
```

**`StockLedgerEntry` is append-only and is the single source of truth for stock.** Every movement is a
signed `qtyDelta` with a `reason`, a `unitCostMinor`, and a `balanceAfterQty`. `BranchInventoryItem.onHandQty`
is a cache written in the same transaction; if it ever disagrees with `SUM(qtyDelta)`, the ledger wins and
a reconciliation job repairs the cache. A mutable stock counter without a ledger is how inventory systems
end up quietly wrong and then abandoned.

**Module 4 (reconciliation) needs no new tables** — it is three queries over one ledger, separated by `reason`:

| Question | Query |
|---|---|
| What did we buy? | `SUM(qtyDelta) WHERE reason = PURCHASE_RECEIPT` |
| What should we have used? | `SUM(-qtyDelta) WHERE reason = SALE_CONSUMPTION` (recipe-derived) |
| What do we actually have? | latest `StockCountLine.countedQty` |
| **Variance** | counted − (opening + purchased − consumed − declared wastage) |

An unexplained negative variance on paneer is pilferage; on tomatoes it is probably spoilage nobody logged.
The report shows both and lets the manager attribute it, and the attribution itself becomes a
`COUNT_ADJUSTMENT` ledger entry, so the trail is closed.

**`BuyingRhythm`** (`DAILY | WEEKLY | FORTNIGHTLY | MONTHLY | AS_NEEDED`) is on the item because a kitchen
does not have *one* purchasing workflow. The daily-fresh list is a phone screen at the mandi at 6 am; the
monthly spice order is a PO e-mailed to a distributor. Generic inventory software models one loop and gets
abandoned. The "buy today" screen filters by rhythm and by `onHandQty < reorderPointQty`, then groups by
`preferredVendorId`.

**Recipes** (`Recipe` + `RecipeLine`, versioned, with `yieldQty` and per-line `wastagePct`) do two jobs:
deplete stock automatically on each settled sale, and produce a live per-dish cost. Versioning means
changing a recipe does not rewrite the cost of orders already sold.

Cost method is **weighted average** (`InventoryItem.avgCostMinor`, recomputed on each goods receipt) rather
than FIFO. FIFO on loose vegetables bought by the crate from a mandi is theatre; weighted average is
honest, cheap and accurate enough to manage a 30% food cost target.

## 5. Vendors & purchasing (module 3)

```
Vendor ──1:N── VendorItemPrice
  ├──1:N── PurchaseOrder ──1:N── PurchaseOrderLine
  │              └──1:N── GoodsReceipt ──1:N── GoodsReceiptLine → StockLedgerEntry
  ├──1:N── VendorInvoice  (billNo, billDate, dueOn = billDate + creditDays)
  └──1:N── VendorPayment ──1:N── VendorPaymentAllocation ──N:1── VendorInvoice
```

- **`GoodsReceipt` is a separate document from the PO**, not a status on it. At a mandi you order 10 kg of
  tomatoes and 8.4 kg arrive, two days late, in two deliveries, and one crate is rejected. Modelling
  receipt as `PurchaseOrderLine.receivedQty += x` alone loses when, who received it, and at what price.
  `billPhotoKey` holds a photo of the paper bill — that is how these vendors actually invoice.
- **`VendorInvoice.dueOn`** is computed from `Vendor.creditDays` (7–15 days is normal here). The payables
  screen is `WHERE status != PAID ORDER BY dueOn` — this is the query that stops you losing a supplier
  relationship over a forgotten ₹4,000.
- **`VendorPaymentAllocation`** is a join because one ₹20,000 payment routinely settles four bills, and one
  bill is sometimes paid in two instalments. Without it, partial payments cannot be tracked honestly.

## 6. Employees, attendance, payroll (modules 5 and 6)

```
Employee ──0:1── User                     (helpers often have no login)
   ├──1:N── SalaryStructure               (versioned — a raise doesn't rewrite old payslips)
   ├──1:N── EmployeeCredential            (PIN | NFC_CARD | BIOMETRIC_REF | MOBILE_DEVICE | QR)
   ├──1:N── ShiftAssignment ──N:1── Shift
   ├──1:N── AttendanceEvent   ← append-only, immutable, low-trust
   ├──1:N── AttendanceDay     ← derived, reviewable, correctable
   ├──1:N── SalaryAdvance
   ├──1:N── LeaveRequest
   └──1:N── PayrollLine ──N:1── PayrollRun
```

The central idea, argued fully in [`ATTENDANCE-RESEARCH.md`](./ATTENDANCE-RESEARCH.md):

> **A punch is a raw immutable event. An attendance day is a derived, correctable record.**

Almost every cheap attendance product conflates the two, which is exactly why they cannot handle a missed
punch, a drifting device clock, or a shift that crosses midnight.

- `AttendanceEvent` carries `source`, `direction`, `deviceId`, `occurredAt` **vs** `recordedAt` (so an
  offline reader can backfill without lying), `lat/lng/accuracyM`, `outsideGeofence`, `photoKey`,
  `rawPayload`, and `correctsEventId`. Nothing is ever updated.
- `AttendanceDay` is recomputed idempotently from the event stream: `firstInAt`, `lastOutAt`,
  `workedMinutes`, `overtimeMinutes`, `lateMinutes`, `status`. Unpairable punches produce
  `NEEDS_REVIEW` with a reason rather than a silently wrong number.
- `lockedByPayrollRunId` freezes days an approved payroll has paid, so history cannot shift under a
  payslip already handed over.
- **Hardware readiness:** `AttendanceDevice` (with a shared secret) and `EmployeeCredential` exist now and
  are unused at launch. Phase 3 screws an NFC reader to the wall, registers it as a device, issues cards as
  credentials, and posts to the *same* `POST /attendance/punch`. **One authentication adapter, zero schema
  change.** No Aadhaar number or biometric template is ever stored — only an opaque vendor reference.
- `SalaryStructure.basis` supports `MONTHLY` and `DAILY` because daily-wage helpers are the norm.
  `payDayOfMonth` defaults to 10 as you specified; `overtimeRateMultiplier` defaults to 2.0 per the
  Factories/Shops Act.
- `SalaryAdvance` is modelled because advances are universal at this wage level and the payroll run must
  deduct them automatically rather than relying on memory.

## 7. Legal documents (module 7)

```
LegalDocument ──1:N── DocumentReminder      (T-60, T-30, T-7, T-1, T-0)
      ├──1:N── DocumentAccessLog            (who downloaded what, when, from where)
      └──self── supersedesDocumentId        (renewal chain)
```

- `fileKey` is an opaque S3 key; there is no public URL anywhere in the model. Access is a short-lived
  presigned URL, `OWNER`/`PARTNER` only, and every issuance writes a `DocumentAccessLog` row.
- Envelope encryption: the object body is encrypted with a per-document data key, which is itself
  encrypted with the master key and stored in `encryptedDataKey`. Compromising the bucket is not enough.
- `checksumSha256` of the plaintext detects silent corruption — which matters when the file you need is
  a partnership deed you will not be able to reproduce.
- `expiresOn` + `renewalLeadDays` drive a daily job that materialises `DocumentReminder` rows and pushes
  them through `NotificationOutbox`. FSSAI, trade licence and shop & establishment are annual renewals;
  the failure mode is a sealed shop, so reminders escalate rather than fire once.
- `supersedesDocumentId` keeps the superseded certificate — you need last year's FSSAI to prove continuity.

## 8. Branch management (module 8)

There is no separate "branch module" and that is the point. `branchId` on every operational table, plus
`UserBranchRole` for access, plus `DailySummary` per branch per day is the whole of it. Consolidated
owner views are `GROUP BY branch_id` over `DailySummary` — which is why branch-vs-branch comparison is a
cheap query on one small table rather than a scan of a year of orders.

## 9. Reporting (module 9)

Two tiers:

1. **Live** — the Today screen queries `orders`/`payments` directly. At 100 orders/day this is
   microseconds and always current.
2. **Rolled up** — `DailySummary` per branch per day, computed by a nightly job and recomputable on demand.
   It holds revenue, discount, tax, COGS, wastage, labour cost, the cash/UPI/card/online split,
   `foodCostBp`, `labourCostBp`, `slotBreakdown` and `topItems`.

`slotBreakdown` is the one partners will stare at: it answers whether the evening Chinese counter actually
earns its gas and its helper's wages, or whether lunch is carrying it. That question is why meal slot is
modelled on the order rather than inferred from a timestamp.

`Expense` + `ExpenseCategory` (with `isFixed`) complete the picture: revenue − COGS − labour − expenses is
a true daily P&L, and the fixed/variable split gives a break-even thali count.

## 10. Cross-cutting tables

| Model | Purpose |
|---|---|
| `AuditLog` | Append-only (UPDATE/DELETE rejected by trigger). Actor, entity, action, before/after diff, IP, request id. Written for every mutation on money, payroll, legal data and access control. Settles partner disputes and satisfies inspection. |
| `IdempotencyRecord` | Key + request hash → stored first response. What makes the offline POS queue safe to retry blindly. |
| `NotificationOutbox` | Durable outbound queue for e-mail/SMS/WhatsApp/push with retries. A lost licence-renewal reminder is a sealed shop. |
| `RefreshToken` | Rotating, hashed, family-tracked. Reuse of a rotated token revokes the family. |
| `OtpChallenge` | Hashed, expiring, attempt-capped customer login codes. |

## Entity count by module

| Module | Models |
|---|---|
| Tenancy / identity / access | 8 |
| Menu | 5 |
| Orders / billing / payments | 12 |
| Inventory / recipes | 8 |
| Vendors / purchasing | 9 |
| Employees / attendance / payroll | 12 |
| Legal documents | 3 |
| Reporting / expenses / audit | 6 |
