# MithilaKitchen — Phased Roadmap

Today: **29 Sep 2026**. Branch #1 (Osman Nagar, Tellapur) opens **15 Oct 2026** — 16 days.

## One thing to settle this week (blocking, not a code problem)

You chose full online ordering with UPI payment on day one. The code for that is built and included.
The **blocker is not software** — it is Razorpay onboarding, which needs:

1. Partnership deed + PAN of the firm
2. A **current account in the firm's name** (settlements cannot go to a personal savings account)
3. FSSAI registration number (they ask for it for food category)
4. GSTIN, or a declaration if you are under the ₹40 L threshold

Activation typically takes 2–5 working days after documents are complete; food category sometimes
triggers a manual review. **Start this on 30 Sep.** If it is not live by 12 Oct, the site ships with
`PAYMENTS_ONLINE_ENABLED=false` — customers still place pickup orders online and pay at the counter, and
you flip one environment variable when Razorpay activates. Nothing needs redeploying or rewriting.

The same applies to the shop's static UPI QR: get it printed and laminated regardless. It is your
highest-margin payment rail (zero MDR) and it is what 80% of walk-ins will use.

---

## Phase 1 — Launch (ships by 14 Oct)

Scope rule for phase 1: **if it does not help you take money, feed people, or know whether you made a
profit today, it waits.**

### 1A. Foundation
- Monorepo, Docker Compose, Postgres 18 + RLS, Redis, Caddy TLS
- Tenant + branch model, seeded with MithilaKitchen / Osman Nagar
- Staff auth (password + Argon2id, JWT + refresh rotation), customer auth (phone OTP)
- RBAC: OWNER, PARTNER, MANAGER, CHEF, HELPER, ACCOUNTANT — branch-scoped
- Audit log on financial/legal/access tables
- CI (lint, typecheck, test, build) and one-command deploy
- **Backups working and a restore actually tested** — before the shop opens, not after

### 1B. Menu & public site
- Categories, items, variants (Half/Full), per-branch per-meal-slot pricing and availability
- Meal slots: `LUNCH` (thali), `CHAI` (all day), `EVENING` (Chinese counter)
- Veg/non-veg/Jain flags, allergen notes, "less oil / home style" badges, Mithila-specialty tag
- Public site in English, Hindi, Telugu: brand story, today's thali, full menu, hours, map, phone/WhatsApp CTA
- `sitemap.xml`, JSON-LD `Restaurant` + `Menu` schema, Open Graph — this is your Google acquisition

### 1C. POS, billing, payments
- Offline-first PWA POS: dine-in (with table), takeaway
- Cart → KOT print → settle → 58mm thermal bill
- Tenders: `CASH`, `UPI_MANUAL` (static QR + UTR), `CARD`, `ONLINE`; split tenders allowed
- Gapless per-branch, per-financial-year invoice numbering allocated inside the DB transaction
- `Idempotency-Key` on every write; IndexedDB queue replays when the connection returns
- Cash session: open with float, close with counted cash, system reports variance (**Z-report**)
- Customer online ordering: browse → cart → phone OTP → pickup slot → Razorpay UPI → webhook confirms
- Settled orders are immutable; corrections are credit notes

### 1D. Inventory (the honest minimum)
- Inventory items with UoM and category: `PERISHABLE`, `STAPLE`, `SPICE`, `PACKAGING`, `GAS`, `CONSUMABLE`
- Buying rhythm per item: `DAILY`, `WEEKLY`, `MONTHLY`, `AS_NEEDED` → drives the purchase worklist
- Append-only stock ledger: purchase, sale-consumption, wastage, count-adjustment, transfer
- Reorder point + par level per branch → **"what to buy today" screen**, grouped by vendor
- Recipes (bill of materials) per menu item/variant → automatic consumption on each settled sale
- Weighted-average cost per item → live **food cost %** per dish and per day

### 1E. Vendors (light)
- Vendor directory with credit days and payment terms
- Purchase orders → goods receipt (accepting partial and over/under delivery)
- Vendor invoices with due dates → **"who do I owe, and when" screen**
- Vendor payments with running balance

### 1F. Employees & attendance (software only)
- Employee records, role type, joining date, salary structure (monthly / daily wage)
- Shifts and shift assignment
- **Manual + QR punch in/out working on day one** — a wall-mounted QR the staff scan on their own phone,
  or the manager taps a name on the tablet
- Derived attendance day: first-in, last-out, hours, late/absent/half-day status
- Salary due on the 10th: payroll run computes from attendance, records advances, produces a payslip
- Hardware-ready: `AttendanceEvent.source` and `EmployeeCredential` already model NFC/biometric — see
  `docs/ATTENDANCE-RESEARCH.md`. Wiring a real reader in phase 3 is one adapter, zero schema change.

### 1G. Legal documents
- Encrypted document vault: partnership deed, FSSAI, trade licence, shop & establishment, rent agreement,
  staff contracts, GST certificate
- Issue date, expiry date, issuing authority, renewal lead time
- Reminder job: e-mail/WhatsApp at T-60, T-30, T-7, T-1 and on expiry
- Every download is logged (who, when, IP) — `OWNER`/`PARTNER` only

### 1H. Reports partners will actually open
- **Today**: revenue, orders, average bill, cash vs UPI split, top items, food cost %
- Daily / weekly / monthly sales
- COGS and food cost % (from recipe consumption at weighted-average cost)
- Staff cost % of revenue
- Variance report: purchased vs recipe-consumed vs physically counted → wastage/pilferage flag
- Day-close checklist that the manager completes before locking the day

### Explicitly NOT in phase 1
Delivery (own or aggregator), loyalty, table reservations, discounts/coupons engine, GST return filing,
multi-branch consolidated dashboards, biometric/NFC hardware, subscription tiffin plans, native mobile app,
Kubernetes.

---

## Phase 2 — Stabilise & tighten (16 Oct – 30 Nov 2026)

Driven by what actually hurts in the first two weeks of trading.

- **Daily-fresh purchasing loop** — morning mandi list on the manager's phone, receive on arrival, photo
  of the bill attached
- **Wastage discipline** — end-of-service wastage capture per dish, and a "thalis sold vs thalis prepped" number
- **Thali forecasting** — simple moving average by weekday to stop over-prepping (your single biggest
  cash leak at 25–100/day)
- Recipe cost alerting when an ingredient price move pushes a dish past its target food-cost %
- Expenses module: rent, electricity, gas refills, repairs → true daily P&L
- WhatsApp Business Cloud API for order-ready notifications and document reminders (free tier is generous)
- Customer records: repeat-customer recognition, order history, favourite thali
- Subscription tiffin plans — likely your best margin product for working-class regulars; monthly prepaid,
  fixed delivery window
- Staff-facing Hindi/Telugu polish based on what confuses them in practice
- Nightly report rollups moved to materialized views once daily data volume makes live aggregation slow
- Restore drill #2, and a documented runbook the non-DevOps partner can follow alone

## Phase 3 — Branch #2 readiness (Dec 2026 – Mar 2027)

- Consolidated owner dashboard: branch-vs-branch revenue, food cost %, staff cost %, wastage
- Central menu with per-branch price overrides and a publish/approval flow
- Inter-branch stock transfers with in-transit state
- **Attendance hardware**: NFC card reader (ESP32 + PN532, ~₹1,200/branch) or a fingerprint device
  (eSSL/Realtime, ~₹4,000) posting to the existing `POST /attendance/punch` with a device HMAC.
  Geofenced mobile punch for the manager and delivery staff.
- Role/permission editor in the UI so a new branch manager can be onboarded without a developer
- Vendor price-comparison across branches and vendors
- Purchase approval thresholds (manager may raise a PO up to ₹X; above that a partner approves)
- GST-ready export: GSTR-1 style B2C summary, HSN summary, purchase register for the CA

## Phase 4 — Mobile app + scale (Apr 2027 onward)

- **React Native (Expo) app** consuming the same API. Two surfaces:
  - *Customer*: menu, order, pay, subscription management, order tracking
  - *Staff*: punch in/out with geofence, KOT screen for the kitchen, manager's approvals inbox
  - Zero new backend work beyond push notifications — the API, auth, RBAC and Zod contracts already exist
- Delivery: own riders with live tracking, then aggregator integrations if the unit economics work
- Analytics depth: cohort retention, item-level contribution margin, hour-of-day heatmaps, menu engineering
  matrix (stars / plough-horses / puzzles / dogs)
- Migrate to Kubernetes **only when** either a second tenant or branch #4 makes one box the constraint.
  The Helm chart is a translation of the existing Compose file; the application does not change.
- Convert Partnership Firm → LLP or Pvt Ltd. The data model already separates `Tenant` (the business)
  from its legal entity fields, so this is a data edit, not a migration.

---

## The 16-day plan to 15 Oct

| Days | Work |
|---|---|
| **30 Sep** | Start Razorpay onboarding. Order the thermal printer + tablet. Print the UPI QR. |
| 30 Sep – 2 Oct | Deploy infra: VPS, Terraform, TLS, Postgres, backups + **a real restore test** |
| 3 – 5 Oct | Load the real menu and real prices. Load recipes for the top 15 dishes. Load real vendors. |
| 6 – 8 Oct | **Train staff on the POS with fake orders.** This is the highest-risk item, not the code. |
| 9 – 11 Oct | Dry run: a full simulated service day, then a day-close and a Z-report that balances. |
| 12 Oct | Go/no-go on online payments. Flip the flag or don't. |
| 13 – 14 Oct | Freeze. Upload legal documents. Enter staff records. Public site live and indexed. |
| **15 Oct** | Open. One partner watches the POS all day and writes down every friction point. |
| 16 Oct | Fix the top three frictions before they become habits. |

**The riskiest thing in this project is staff adoption, not the software.** Budget three full days for
training with realistic fake orders, and keep a paper pad under the counter as the fallback for week one.
