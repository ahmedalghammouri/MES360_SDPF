#!/usr/bin/env bash
# Delete a work order on the server, with the diagnosis built in.
#
#   ./scripts/wipe-wo.sh WO-2026-0005                 # preview only
#   ./scripts/wipe-wo.sh WO-2026-0005 --apply         # do it
#   ./scripts/wipe-wo.sh WO-2026-0005 --apply --stop-api
#
# ── Why this exists ─────────────────────────────────────────────────────────
# The SQL file is written for pgAdmin, where a human runs each block. Piped
# through psql on a server it hung after two statements with no message, was
# Ctrl-C'd, and every Ctrl-C left another session holding locks for the next
# attempt to block on. Three tries, no progress, nothing to read.
#
# Nothing about the delete is slow -- it plans in 0.6 ms on the same data, there
# are no triggers on downtime_events and nothing references it. It waits on a
# LOCK, held by the api or the gateway writing downtime events, or by an
# abandoned psql from an earlier attempt.
#
# So this looks first, says what it found, and only then acts.
set -uo pipefail

WO="${1:-}"
shift || true
APPLY=0; STOP_API=0
for a in "$@"; do
  case "$a" in
    --apply)    APPLY=1 ;;
    --stop-api) STOP_API=1 ;;
    *) echo "unknown option: $a"; exit 2 ;;
  esac
done

if [ -z "$WO" ]; then
  echo "usage: $0 <WORK-ORDER-NUMBER> [--apply] [--stop-api]"
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
PGC="${PGC:-mes-postgres-prod}"
COMPOSE="${COMPOSE:-docker-compose.hostinger.yml}"
PG="docker exec -i $PGC psql -U mes_user -d mes360"

hr() { printf '%s\n' "-------------------------------------------------------------------"; }

# ── 1. Who is holding a transaction open? ───────────────────────────────────
hr; echo "SESSIONS HOLDING A TRANSACTION"; hr
$PG -c "
SELECT pid, state, age(now(), xact_start) AS in_txn,
       left(regexp_replace(query, '\s+', ' ', 'g'), 60) AS query
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
   AND xact_start IS NOT NULL
 ORDER BY xact_start;"

STALE=$($PG -At -c "
SELECT count(*) FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
   AND state = 'idle in transaction' AND age(now(), xact_start) > interval '1 minute';")

if [ "${STALE:-0}" -gt 0 ]; then
  echo
  echo "  !! $STALE session(s) idle in a transaction for over a minute."
  echo "     Almost certainly an abandoned attempt of this script. They hold the"
  echo "     locks that make the delete hang. Free them with:"
  echo
  $PG -At -F' ' -c "
    SELECT '       docker exec -i $PGC psql -U mes_user -d mes360 -c \"SELECT pg_terminate_backend(' || pid || ');\"'
      FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND state = 'idle in transaction' AND age(now(), xact_start) > interval '1 minute';"
  echo
  echo "     Terminate ONLY those. Not the api or gateway connections -- they are"
  echo "     writing production data."
fi

# ── 2. What would go ────────────────────────────────────────────────────────
echo
hr; echo "WHAT WOULD BE DELETED FROM $WO"; hr
sed "s/WO-2026-0005/$WO/g" "$HERE/../apps/api/prisma/sql/wipe-work-order.sql" \
  | sed -n '/^WITH wo AS/,/^ORDER BY 1;$/p' | $PG

if [ "$APPLY" -ne 1 ]; then
  echo
  hr
  echo "PREVIEW ONLY. Nothing changed."
  echo "To do it:  $0 $WO --apply"
  hr
  exit 0
fi

# ── 3. Optionally take the writers out of the way ───────────────────────────
if [ "$STOP_API" -eq 1 ]; then
  echo
  hr; echo "STOPPING THE API so it cannot hold a lock"; hr
  docker compose -f "$HERE/../$COMPOSE" stop api
  # The gateway writes too, but it lives on the plant PC and is not ours to
  # stop from here. Its writes are short; the api's are the ones that overlap.
fi

# ── 4. Do it ────────────────────────────────────────────────────────────────
echo
hr; echo "DELETING"; hr
OUT=$( { sed "s/WO-2026-0005/$WO/g" "$HERE/../apps/api/prisma/sql/wipe-work-order.sql"; echo "COMMIT;"; } \
       | $PG -v ON_ERROR_STOP=1 2>&1 )
RC=$?
echo "$OUT" | grep -E '^(BEGIN|SET|DELETE|UPDATE|COMMIT|ROLLBACK|ERROR|psql)' || true

if [ "$STOP_API" -eq 1 ]; then
  echo
  hr; echo "STARTING THE API AGAIN"; hr
  docker compose -f "$HERE/../$COMPOSE" start api
fi

# ── 5. Say plainly whether it worked ────────────────────────────────────────
echo
hr; echo "RESULT"; hr
LEFT=$($PG -At -c "SELECT count(*) FROM work_orders WHERE \"orderNumber\" = '$WO';")

if echo "$OUT" | grep -q 'lock timeout'; then
  echo "  LOCKED. Something else holds the rows and would not let go in 5s."
  echo "  Re-run with --stop-api, or free the sessions listed at the top."
elif [ "$RC" -ne 0 ] || echo "$OUT" | grep -q '^ERROR'; then
  echo "  FAILED. Nothing was saved -- the transaction never committed."
  echo "$OUT" | grep '^ERROR' | head -3
elif [ "${LEFT:-1}" -eq 0 ]; then
  echo "  DONE. $WO is gone, and so is everything recorded against it."
else
  echo "  NOT SAVED. The statements ran but $WO is still there, which means the"
  echo "  transaction rolled back. That is what happens when the appended COMMIT"
  echo "  does not reach psql -- check for a stray backslash in the command."
fi
hr
