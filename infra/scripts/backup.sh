#!/bin/sh
# Nightly logical backup: pg_dump -> age-encrypt -> S3, with a checksum.
#
# The private age key is NOT on this server. A compromised VPS can write backups but
# cannot read its own backup history. The trade-off is that losing the key loses the
# backups, so it lives in the partners' password manager AND on an offline USB stick,
# and the recovery procedure is printed on paper in the shop safe.
set -eu

: "${POSTGRES_DB:?}" "${POSTGRES_USER:?}" "${BACKUP_S3_BUCKET:?}"
STAMP=$(date -u +%Y-%m-%dT%H-%M)
OUT="/backups/${POSTGRES_DB}-${STAMP}.dump"
HOST="${POSTGRES_HOST:-postgres}"

echo "[backup] dumping ${POSTGRES_DB} from ${HOST}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "$HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --compress=9 --file="$OUT"

SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 10000 ]; then
  # A dump this small means the database is empty or the dump failed silently — the
  # exact situation an unmonitored backup job hides for six months.
  echo "[backup] FAILED: dump is only ${SIZE} bytes" >&2
  exit 1
fi

if [ -n "${AGE_RECIPIENT:-}" ]; then
  age -r "$AGE_RECIPIENT" -o "${OUT}.age" "$OUT"
  rm -f "$OUT"
  OUT="${OUT}.age"
fi

sha256sum "$OUT" > "${OUT}.sha256"

echo "[backup] uploading $(basename "$OUT") (${SIZE} bytes)"
aws s3 cp "$OUT" "s3://${BACKUP_S3_BUCKET}/postgres/" --only-show-errors
aws s3 cp "${OUT}.sha256" "s3://${BACKUP_S3_BUCKET}/postgres/" --only-show-errors

# Local copies are a convenience, not the backup. Keep a week.
find /backups -name "*.dump*" -mtime +7 -delete

# Dead-man's switch: the absence of this ping is what alerts, because a backup job that
# silently stops is the failure mode that actually kills businesses.
if [ -n "${HEALTHCHECK_PING_URL:-}" ]; then
  wget -q -O /dev/null "$HEALTHCHECK_PING_URL" || true
fi

echo "[backup] done"
