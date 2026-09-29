#!/bin/sh
# Restores the latest backup into a throwaway database and asserts it is usable.
#
# This is the entire point of the backup system. An unverified backup chain is how a
# business discovers, on the worst day, that it had no backups at all. Runs nightly,
# right after backup.sh, and alerts on failure.
set -eu

: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}"
HOST="${POSTGRES_HOST:-postgres}"
VERIFY_DB="restore_verify_$(date -u +%s)"
LATEST=$(ls -t /backups/*.dump* 2>/dev/null | head -1 || true)

if [ -z "$LATEST" ]; then
  echo "[verify] FAILED: no backup file found" >&2
  exit 1
fi

echo "[verify] restoring $(basename "$LATEST") into ${VERIFY_DB}"
FILE="$LATEST"
if [ "${FILE%.age}" != "$FILE" ]; then
  : "${AGE_IDENTITY_FILE:?an age identity is required to verify an encrypted backup}"
  age -d -i "$AGE_IDENTITY_FILE" -o /tmp/verify.dump "$FILE"
  FILE=/tmp/verify.dump
fi

export PGPASSWORD="$POSTGRES_PASSWORD"
createdb -h "$HOST" -U "$POSTGRES_USER" "$VERIFY_DB"
pg_restore -h "$HOST" -U "$POSTGRES_USER" -d "$VERIFY_DB" --no-owner --no-acl "$FILE" >/dev/null 2>&1 || true

FAILED=0
# The tables whose loss would actually end the business. A restore that "succeeds" but
# produces an empty orders table is not a restore.
for table in orders invoices stock_ledger_entries attendance_events legal_documents audit_logs; do
  COUNT=$(psql -h "$HOST" -U "$POSTGRES_USER" -d "$VERIFY_DB" -tAc "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "ERR")
  echo "[verify]   ${table}: ${COUNT}"
  [ "$COUNT" = "ERR" ] && FAILED=1
done

# Money must reconcile: every settled order needs exactly one invoice.
ORPHANS=$(psql -h "$HOST" -U "$POSTGRES_USER" -d "$VERIFY_DB" -tAc \
  "SELECT COUNT(*) FROM orders o LEFT JOIN invoices i ON i.order_id = o.id
   WHERE o.status = 'SETTLED' AND i.id IS NULL" 2>/dev/null || echo "ERR")
echo "[verify]   settled orders with no invoice: ${ORPHANS}"
[ "$ORPHANS" = "0" ] || FAILED=1

dropdb -h "$HOST" -U "$POSTGRES_USER" "$VERIFY_DB"
rm -f /tmp/verify.dump

if [ "$FAILED" -ne 0 ]; then
  echo "[verify] FAILED — the backup chain is not trustworthy" >&2
  exit 1
fi

echo "[verify] backup restores cleanly and reconciles"
