# Backup & Disaster Recovery

**Targets:** RPO ≤ 5 minutes (WAL archiving). RTO ≤ 30 minutes (documented, drilled).

A backup you have not restored is not a backup. **Do the first restore drill before 15 Oct**, not after.

## What has to survive

| Asset | Loss impact | Strategy |
|---|---|---|
| Postgres | Total. Orders, stock, payroll, payables. | Nightly base backup + continuous WAL to S3 |
| S3 objects (legal docs, bills, payslips) | Severe — some documents are irreplaceable | Bucket versioning + cross-region replication + weekly local copy |
| `.env` / secrets | Cannot boot | Terraform-rendered; encrypted copy in a password manager (Bitwarden/Vault) |
| Redis | None by design | Not backed up. Queues are rebuilt; sessions are stateless JWT. |
| Container images | Rebuildable | GHCR, tagged by commit SHA |

## Postgres

Two independent mechanisms, because they fail differently.

**1. Logical — `pg_dump`, nightly 02:30 IST.** `infra/scripts/backup.sh`: custom-format dump →
age-encrypted → S3 with `SHA256SUMS`. Retention 7 daily / 4 weekly / 12 monthly. Survives corruption that
a physical backup would faithfully reproduce, and can be restored into a different Postgres version.

**2. Physical — pgBackRest, continuous WAL + weekly full.** Point-in-time recovery to any moment, which is
what you need after an accidental `DELETE`. `archive_timeout = 300s` sets the 5-minute RPO.

```bash
make backup            # ad-hoc logical backup now
make restore-verify    # nightly: restore into a throwaway container and assert
make restore FILE=...  # the real thing (prompts, refuses without CONFIRM=yes)
```

`restore-verify` runs **automatically every night** after the backup and is the whole point: it restores
the dump into a scratch container, runs `prisma migrate status`, and asserts row counts on `orders`,
`invoices`, `stock_ledger_entries`, `attendance_events` and `legal_documents` are non-zero and match the
source within tolerance. If it fails, the partners get alerted. An unverified backup chain is the normal
way businesses discover they had none.

## Encryption

`age` with a keypair generated once. The **private key is not on the server** — it lives in the partners'
password manager and on an offline USB stick. A compromised VPS therefore cannot read its own backup
history. Trade-off: lose the key and the backups are unrecoverable, so the key is in two places and the
recovery procedure is printed on paper in the shop safe.

## Recovery runbook

### A. Application down, data intact (most likely)
```bash
ssh mk-prod && cd /opt/mithilakitchen
docker compose ps && docker compose logs --tail=200 api
docker compose up -d --force-recreate api web
```
**RTO ~2 min.** The POS keeps taking orders offline throughout; they replay on reconnect.

### B. Database corrupted / bad migration
```bash
make restore FILE=s3://mk-backups/postgres/2026-10-16T02-30.dump.age CONFIRM=yes
```
**RTO ~15 min** at launch data volumes.

### C. Accidental deletion — point-in-time recovery
```bash
pgbackrest --stanza=mk --type=time --target="2026-10-16 13:45:00+05:30" restore
```
**RTO ~20 min.** This is the case the logical dump cannot solve, which is why both exist.

### D. Server destroyed
```bash
cd infra/terraform && terraform apply        # new VPS, firewall, DNS
ssh mk-prod 'cd /opt/mithilakitchen && make restore-latest CONFIRM=yes'
```
**RTO ~30 min**, dominated by DNS propagation and image pull. Practise this once in November.

### E. Provider region gone
Backups live in a different provider from the compute (Hetzner box, Backblaze B2 bucket) precisely so this
is case D with a different `terraform apply`. Do not put backups in the same account as the server.

## Business continuity while the system is down

This matters more than the RTO number. The shop cannot stop serving lunch because Postgres is down.

1. **POS keeps working offline.** Orders queue in IndexedDB and replay. This covers most incidents entirely.
2. **Paper fallback.** A duplicate-carbon bill book stays under the counter. Week-one policy: use it in
   parallel for the first three days regardless, so staff have a rehearsed fallback rather than a panic.
3. **Cash is always accepted.** UPI via the static QR works without our system at all — the bank confirms
   it, not us. This is another reason `UPI_MANUAL` is a first-class tender.
4. Back-entry screen for reconciling paper bills once service ends.

## Verification schedule

| Frequency | Check |
|---|---|
| Nightly | Backup ran, uploaded, checksum matches; automated restore-verify passed |
| Weekly | Someone eyeballs the backup list and sizes; alert if a size drops >20% |
| Monthly | Manual restore to staging; log in and open a real order |
| Quarterly | Full DR drill — rebuild from Terraform, time it, update this document with the actual RTO |
| On hire/exit | Rotate secrets, re-encrypt with a new age recipient set |

## Monitoring

Uptime Kuma (self-hosted, free) pings `/health/ready` and the public site every 60 s and alerts the
partners over Telegram/WhatsApp. A dead-man's-switch on the backup job — if the "backup succeeded" ping
does not arrive by 03:15 IST, that also alerts. A silent backup failure is the failure mode that actually
kills businesses, so it is monitored by its *absence*, not by its errors.
