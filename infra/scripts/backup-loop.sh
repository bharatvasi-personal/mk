#!/bin/sh
# The backup container's entrypoint: sleep until 02:30 IST, back up, verify, repeat.
#
# A shell loop rather than cron because the container is already a process supervisor,
# and a crashed loop is visible in `docker compose ps` where a silently-dead cron is not.
set -eu

apk add --no-cache aws-cli age >/dev/null 2>&1 || true

while true; do
  NOW=$(date -u +%s)
  # 02:30 IST == 21:00 UTC the previous day.
  NEXT=$(date -u -d 'tomorrow 21:00' +%s 2>/dev/null || echo $((NOW + 86400)))
  [ "$NEXT" -le "$NOW" ] && NEXT=$((NEXT + 86400))
  SLEEP=$((NEXT - NOW))
  echo "[backup-loop] next run in $((SLEEP / 3600))h"
  sleep "$SLEEP"

  if /scripts/backup.sh; then
    /scripts/restore-verify.sh || echo "[backup-loop] VERIFY FAILED — investigate today" >&2
  else
    echo "[backup-loop] BACKUP FAILED" >&2
  fi
done
