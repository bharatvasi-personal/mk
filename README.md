# MithilaKitchen

Business management platform for a home-style food business in Osman Nagar, Tellapur
(Hyderabad, 502300). Public website, counter POS, and back-office — one backend, three
clients, with a mobile app able to slot in later without new backend work.

**Branch #1 opens 15 October 2026.**

```bash
make setup     # deps, containers, schema, seed data
make dev       # API on :4000, website on :3000
```

| | |
|---|---|
| Public site | http://localhost:3000/en · `/hi` · `/te` |
| Counter (POS) | http://localhost:3000/en/pos |
| Kitchen display | http://localhost:3000/en/kitchen |
| Back office | http://localhost:3000/en/admin |
| API reference | http://localhost:4000/api/docs |

Seed logins (change these before the shop opens):

| Role | Sign in | Password |
|---|---|---|
| Owner | `owner@mithilakitchen.in` | `ChangeMe@12345` |
| Manager | `manager@mithilakitchen.in` | `Manager@12345` |
| Counter staff | `counter@mithilakitchen.in` | `Counter@12345` |

## Documentation

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Stack and the reasoning, multi-tenancy, authorization, cross-cutting concerns |
| [Data model](docs/DATA-MODEL.md) | All 63 entities across the nine modules, and why they are shaped that way |
| [Roadmap](docs/ROADMAP.md) | What ships for 15 Oct, what follows, and the 16-day plan |
| [Attendance research](docs/ATTENDANCE-RESEARCH.md) | What Indian SMEs actually use, and what we built for |
| [Backup & DR](docs/BACKUP-DR.md) | RPO/RTO, the runbook, and the verification schedule |
| [Infrastructure](infra/terraform/README.md) | Terraform, and when Kubernetes becomes worth it |

## Shape of the code

```
apps/api          NestJS + Fastify + Prisma. The only thing that touches the database.
apps/web          Next.js 15. Public site, POS, kitchen display, back office.
packages/shared   Zod contracts, the RBAC matrix, money maths, en/hi/te dictionaries.
infra             Compose, Caddy, Terraform, backup and restore scripts.
tests             End-to-end smoke test — 53 assertions against a real API.
docs              The documents above.
```

`packages/shared` is the seam that makes the mobile app cheap: every request and response
schema, the permission matrix and all UI strings live there, so a React Native client is
type-safe against the live API on day one.

## The decisions worth knowing about

**Money is integer paise everywhere** — database, API and UI. `₹120.50` is `12050`. One
exact representation, no float rounding, no conversion boundary to get wrong.

**GST is extracted, not added.** Indian restaurant menus quote GST-inclusive prices, so a
₹120 thali at 5% is ₹114.29 + ₹5.71, never ₹126. Getting this backwards is the most common
billing bug in Indian POS software and it makes every GST return wrong.

**Tenant isolation is enforced by Postgres, not by `where` clauses.** Every tenant table
has a `FORCE`d row-level-security policy keyed on a transaction-local setting, and the app
connects as a role with neither `SUPERUSER` nor `BYPASSRLS`. A forgotten filter returns
zero rows, not someone else's data. CI fails if any table with a `tenant_id` lacks a policy.

**The POS works offline.** Bills are written to IndexedDB with a client-generated UUID and
replayed with an `Idempotency-Key`; the server keys on both, so a blind retry returns the
original bill rather than charging twice. Osman Nagar will lose power and 4G, and the
counter cannot stop.

**Settled bills are immutable.** Corrections are credit notes. Stock is an append-only
ledger, not a mutable counter. Attendance punches are immutable evidence; the *day* is the
derived, correctable record. Database triggers enforce all of this — application code can
have a bug, a trigger cannot be forgotten.

**Invoice numbers are gapless.** A row lock inside the settle transaction, not a Postgres
sequence — sequences leak numbers on rollback, and a GST auditor will ask about the gap.

**Attendance hardware is modelled but not installed.** Launch uses a rotating wall QR and
a manager tap. An NFC reader in phase 3 registers as an `AttendanceDevice`, issues
`EmployeeCredential` rows and posts to the same `POST /attendance/punch`. One
authentication adapter, zero schema change. No Aadhaar number or biometric template is
ever stored.

## Before 15 October

1. **Start Razorpay onboarding now.** It needs the partnership deed, a current account in
   the firm's name, the FSSAI number and GSTIN, and takes 2–5 working days. If it is not
   live by 12 Oct, ship with `PAYMENTS_ONLINE_ENABLED=false` — customers still order online
   and pay at the counter, and you flip one variable when it activates.
2. **Run a restore drill.** `make backup && make restore-verify`. A backup you have not
   restored is not a backup.
3. **Train the staff for three days with fake orders.** The riskiest thing in this project
   is adoption, not the software. Keep a carbon bill book under the counter for week one.
4. **Load real prices and real recipes.** The seed is realistic but invented. Food cost
   percentage is only worth reading once the recipes are yours.
5. **Upload the legal documents with their real expiry dates**, so the renewal reminders
   have something to fire on. FSSAI, trade licence and shop & establishment are annual, and
   the failure mode is a sealed shop.

## Testing

```bash
make check      # typecheck + unit tests (money maths, RBAC, i18n key parity)
make test-e2e   # 53 assertions against a running API: POS flow, RLS, immutability, webhooks
```

## Licence

Private. © MithilaKitchen (Partnership Firm).
