#!/bin/sh
# Restores a backup over the LIVE database. Destructive, and deliberately awkward.
set -eu

: "${POSTGRES_DB:?}" "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}"
FILE="${1:-}"
HOST="${POSTGRES_HOST:-postgres}"

if [ -z "$FILE" ]; then
  echo "usage: restore.sh <dump-file|s3://...>   (requires CONFIRM=yes)" >&2
  exit 2
fi

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This REPLACES the live ${POSTGRES_DB} database. Re-run with CONFIRM=yes." >&2
  exit 2
fi

case "$FILE" in
  s3://*) aws s3 cp "$FILE" /tmp/restore.dump --only-show-errors; FILE=/tmp/restore.dump ;;
esac

if [ "${FILE%.age}" != "$FILE" ]; then
  : "${AGE_IDENTITY_FILE:?}"
  age -d -i "$AGE_IDENTITY_FILE" -o /tmp/restore.plain "$FILE"
  FILE=/tmp/restore.plain
fi

export PGPASSWORD="$POSTGRES_PASSWORD"

# Keep what is being replaced. A restore of the wrong file must itself be reversible.
SAFETY="/backups/pre-restore-$(date -u +%Y-%m-%dT%H-%M).dump"
echo "[restore] taking a safety dump to ${SAFETY}"
pg_dump -h "$HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file="$SAFETY"

echo "[restore] restoring ${FILE}"
pg_restore -h "$HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl "$FILE"

echo "[restore] done. Now re-apply the security objects:"
echo "  docker compose exec api npm run db:security"
