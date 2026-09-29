# MithilaKitchen — Architecture

## 1. Guiding constraints

| Constraint | Consequence |
|---|---|
| 2–3 partners, bootstrapped, ~25–100 thalis/day at launch | One VPS. No Kafka, no microservices, no managed SaaS bills. |
| Must run a physical counter in Osman Nagar with flaky power/4G | POS is offline-first; orders are idempotent. |
| Mobile app follows later, reusing the backend | Backend is a **pure JSON API**. The website is one of several clients. No server-rendered-only business logic. |
| Multi-tenant "in principle" | Tenant isolation enforced in the **database**, not in application `where` clauses. |
| Multi-branch from day one | `branchId` is a first-class scope on inventory, menu pricing, staff, orders, and every report. |
| DevOps/SRE partner | Everything containerised, Terraform for the VPS + object storage, GitHub Actions CI/CD, `make`-driven ops. Escape hatch to Kubernetes exists but is not used at launch. |
| Money and legal documents | Append-only audit trail, immutable settled invoices, encrypted document storage. |

The biggest architectural risk in this project is **not** scale. It is a 12x18 ft shop opening in two weeks
with staff who have never used software. The architecture therefore optimises for: few moving parts,
a POS that works when the internet does not, and the ability to restore the whole business from a
backup in under 30 minutes.

## 2. Stack

### Frontend — Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS

One Next.js application, three route groups:

| Route group | Audience | Rendering |
|---|---|---|
| `(public)` | Customers, Google | Static / ISR. SEO matters — "home food Tellapur" is the acquisition channel. |
| `(pos)` | Counter staff | Client-side PWA, service worker, IndexedDB queue. Installed to the tablet home screen. |
| `(admin)` | Partners, manager | Client-side dashboard, server components for initial data. |

**Why one app, not three:** shared i18n dictionaries, shared design system, one deploy, one TLS cert.
The route groups have separate layouts and separate middleware rules, so they behave as three products.

**Why Next.js:** the public menu site needs real SEO and fast first paint on a ₹8,000 Android phone
over 4G; the admin needs a rich client. Next is the only mainstream choice that does both well without
two codebases. It is MIT-licensed and self-hosts fine in a container (`output: "standalone"`) — we are
not using Vercel.

**State:** TanStack Query for all server state (it gives us retry, cache, optimistic updates and offline
mutation persistence for free — that is most of the POS's hard problem). Zustand for POS-local cart state.

**i18n:** `next-intl`. English, Hindi, Telugu at launch (`/en`, `/hi`, `/te`). Dictionaries live in
`packages/shared/src/i18n` so the future React Native app reuses the exact same strings.

### Backend — NestJS 11 + Fastify adapter + TypeScript

**Why NestJS:** nine business modules with overlapping concerns (every one of them needs tenant scope,
RBAC, audit logging, validation). Nest's module + DI + guard + interceptor model gives one place to
implement each cross-cutting concern instead of nine. Its `@nestjs/swagger` output is what the mobile
app's typed client is generated from. Fastify adapter rather than Express for throughput and lower memory
on a small box.

**Why not a Next.js API / server actions monolith:** server actions are not an API. A React Native app
cannot call them. Splitting the API out now costs one extra container; retrofitting it later costs a rewrite.

Layering per module: `Controller` (HTTP, DTO validation) → `Service` (business rules, transactions) →
`Repository`/Prisma (data). Domain events via an in-process emitter, consumed by BullMQ workers for
anything slow or retryable (stock depletion on sale, reminder emails, report rollups, webhook processing).

### Database — PostgreSQL 18 + Prisma 6

**Why Postgres:** we need real transactions (a bill, its payment, its stock depletion and its audit rows
must commit together or not at all), row-level security for tenancy, `numeric` for money, JSONB for
flexible document metadata, and materialized views for reports. One database does all of it. It is free.

**Why Prisma:** type-safe schema-as-code, migrations in git, and the generated types flow into both the
API and the web app. Where Prisma is the wrong tool — reporting aggregates, gapless invoice sequences —
we drop to raw SQL deliberately.

Money is `NUMERIC(12,2)` in the database and **integer paise** in transit and in the API. Never a float,
anywhere.

### Cache / queue — Redis 7 + BullMQ

Sessions are stateless JWT, so Redis is only for: BullMQ job queues, rate limiting, idempotency-key
storage, and short-lived OTP codes. Losing Redis loses no business data by design.

### File storage — S3-compatible (MinIO self-hosted, or Backblaze B2 / Cloudflare R2)

Legal documents, invoices, menu photos. Server-side encryption at rest plus envelope encryption of the
object body for the legal-document bucket. All access is via short-lived presigned URLs — the API never
proxies bytes. `LegalDocument` rows store only an opaque key, never a public URL.

### Payments — Razorpay (primary), behind a provider interface

| Option | UPI | Fees | Verdict |
|---|---|---|---|
| **Razorpay** | Excellent — UPI intent, collect, QR, autopay | 2% cards, **UPI 0% up to ₹2,000/txn** | **Chosen.** Best docs, best webhooks, instant onboarding for a partnership firm with GST + current account. |
| Cashfree | Excellent | Comparable, sometimes lower | Strong second. Provider interface makes switching a day's work. |
| PhonePe PG | UPI-native | Low | Thinner SDK/docs; good later as a UPI-only cheap rail. |
| Stripe | Weak UPI in India | Higher | No. |

Implementation: `PaymentProvider` port with `createOrder`, `verifySignature`, `capture`, `refund`.
`RazorpayProvider` is the only adapter at launch. **We never see a card number** — Razorpay Standard
Checkout is loaded in the browser, funds are confirmed by a server-side webhook whose HMAC-SHA256
signature we verify, and the order is only marked `PAID` by that webhook. This keeps us at PCI-DSS SAQ-A.

For walk-in UPI (the dominant case) the shop's static UPI QR is used and the POS records
`tender = UPI_MANUAL` with the collected UTR — cheaper than routing counter sales through a gateway.

### Auth — self-hosted, in-house

- **Staff:** phone or email + password (Argon2id), optional TOTP for partners. Access JWT (15 min,
  RS256) + rotating refresh token (30 days, hashed in DB, one-time-use, reuse detection revokes the family).
- **Customers:** phone + OTP via MSG91 (cheapest reliable Indian SMS). No password to forget.
- **Web** gets the refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie; **mobile** gets it in the
  response body for secure-storage. Same endpoints, one `client` flag — this is why the mobile app needs
  no new auth work.

**Why not Keycloak:** it is a 700 MB JVM to solve a problem we do not have (federation, SSO, SCIM).
Our authorization is business-specific (branch-scoped roles), which Keycloak would not own anyway.

### Infrastructure — Docker Compose on one VPS, Terraform-provisioned

```
                    Internet
                       │  443
                 ┌─────▼──────┐
                 │   Caddy    │  automatic Let's Encrypt, HSTS, gzip/zstd
                 └──┬──────┬──┘
           /api/*   │      │  /*
              ┌─────▼─┐  ┌─▼──────┐
              │  api  │  │  web   │   Next.js standalone
              │ Nest  │  └────────┘
              └──┬─┬──┘
      ┌──────────┘ └──────────┬─────────────┐
 ┌────▼─────┐          ┌──────▼────┐  ┌─────▼────┐
 │ Postgres │          │   Redis   │  │  worker  │  BullMQ
 │    18    │          │     7     │  │  (Nest)  │
 └────┬─────┘          └───────────┘  └──────────┘
      │ WAL + nightly base backup
 ┌────▼──────────────┐
 │ S3 (B2/R2/MinIO)  │  encrypted, versioned, 35-day retention
 └───────────────────┘
```

Target box: Hetzner CPX31 (4 vCPU / 8 GB / 160 GB NVMe, ~€14/mo) or AWS Lightsail 4 GB. This comfortably
serves 100× the launch volume. Terraform provisions the server, firewall, DNS and backup bucket;
`cloud-init` installs Docker; GitHub Actions builds images to GHCR and deploys over SSH.

**On Kubernetes:** the Compose file maps 1:1 to the Helm chart in `infra/k8s` when branch #4 or a second
tenant justifies it. Running k8s for one shop would mean the SRE partner babysitting a control plane
instead of selling thalis. The containers, health checks, 12-factor config and stateless app tier mean
that migration is a deployment change, not an application change.

## 3. Multi-tenancy — defence in depth

Three independent layers. Any one of them failing does not leak data.

**Layer 1 — schema.** Every tenant-owned table carries a non-null `tenant_id`, and every business
unique constraint is composite on `tenant_id` — so two tenants can each have an "Aloo Sabzi" and neither
can collide with or overwrite the other. Cross-tenant foreign-key references are blocked by layer 2
rather than by composite FKs, which Prisma models poorly; a `CHECK` trigger on the highest-risk parents
(`branches`, `orders`) additionally asserts that a child's `tenant_id` matches its parent's.

**Layer 2 — PostgreSQL Row-Level Security.** Every tenant table has `ENABLE ROW LEVEL SECURITY` and a
`FORCE`d policy:

```sql
CREATE POLICY tenant_isolation ON "Order"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

The application connects as a **non-superuser, non-bypassrls** role. Every request runs inside a
transaction that first executes `SET LOCAL app.tenant_id = $1`. A developer who forgets
`where: { tenantId }` gets zero rows, not someone else's rows. Migrations run as a separate privileged role.

**Layer 3 — application.** `TenantContext` (AsyncLocalStorage) is populated from the verified JWT.
A Prisma client extension asserts the context exists and injects `tenantId` on every create. Branch
scoping is enforced by `BranchScopeGuard` against the user's `UserBranchRole` grants.

Tenant resolution is by **JWT claim**, not by hostname — so the same deployment can serve a custom
domain, a subdomain, or a mobile app without different code paths.

## 4. Authorization model

Roles are **per (user, branch)**, not global — a manager can run Tellapur and be a helper at branch #2.

| Role | Scope |
|---|---|
| `OWNER` | Tenant-wide. Everything, including legal documents, payroll, other users' access, tenant settings. |
| `PARTNER` | Tenant-wide. Everything except changing another partner's access and deleting the tenant. |
| `MANAGER` | Branch. Menu, orders, inventory, vendors, POs, attendance, staff shifts. Sees branch P&L, not payroll of partners. |
| `CHEF` | Branch. Menu read, KOT screen, stock issue/wastage entry, own attendance. |
| `HELPER` | Branch. POS order entry and settle, own attendance. No reports, no cost prices. |
| `ACCOUNTANT` | Tenant-wide read on financials, vendor payment entry. No menu/staff writes. |

Permissions are fine-grained strings (`order:settle`, `payroll:read`, `legal:download`) defined once in
`packages/shared/src/rbac.ts` and mapped to roles there. Guards check permissions, never role names, so
adding a role later touches one file. The **same** file is imported by the web app to hide UI — one
source of truth, no drift between what the UI shows and what the API allows.

## 5. Cross-cutting concerns

**Audit trail.** A Prisma extension writes an `AuditLog` row for every mutation on a financial, payroll,
legal or access-control table: actor, IP, entity, action, before/after JSON diff, request id. The table
is append-only (a trigger rejects `UPDATE`/`DELETE`). This is both a legal requirement and the only way
to settle a dispute between partners about who changed a price.

**Idempotency.** Every unsafe POS/mobile endpoint accepts `Idempotency-Key`. The key plus a hash of the
request body is stored in Redis for 24 h with the first response; a replay returns the stored response.
This is what makes the offline queue safe to retry blindly.

**Immutability.** A settled `Order` and its `Invoice` are never mutated. Corrections are a `CreditNote`
referencing the original. Stock is an append-only `StockLedgerEntry`; on-hand quantity is the sum of the
ledger (with a periodically refreshed snapshot for speed), never a mutable counter that can drift.

**Observability.** Pino structured JSON logs with a request id propagated from Caddy; `/health/live` and
`/health/ready`; Prometheus metrics at `/metrics`; optional Grafana + Loki + Prometheus profile in the
Compose file, off by default to save RAM. Uptime Kuma (self-hosted, free) pings the public site and the
API health endpoint and alerts the partners' WhatsApp/Telegram.

**Secrets.** Never in git. `.env` on the box is `chmod 600` and rendered by Terraform from variables;
CI secrets live in GitHub Actions secrets. The app reads config through a validated Zod schema at boot
and refuses to start if anything is missing or malformed — a misconfigured production is a crash, not a
silent fallback to a development default.

## 6. Repository layout

```
mithilakitchen/
├─ apps/
│  ├─ api/            NestJS — the only thing that touches the database
│  └─ web/            Next.js — public site, POS, admin
├─ packages/
│  └─ shared/         Zod contracts, RBAC matrix, money utils, i18n dictionaries
├─ infra/
│  ├─ compose/        docker-compose.yml + prod override
│  ├─ caddy/          Caddyfile
│  ├─ terraform/      VPS, firewall, DNS, backup bucket
│  └─ scripts/        backup, restore, restore-verify
├─ docs/              this file, DATA-MODEL, ROADMAP, BACKUP-DR, ATTENDANCE-RESEARCH
└─ .github/workflows/ ci, deploy
```

`packages/shared` is the seam that makes the mobile app cheap: it contains every request/response schema
as a Zod object, the RBAC matrix, money formatting, and all UI strings. A React Native app imports it
and is immediately type-safe against the live API.
