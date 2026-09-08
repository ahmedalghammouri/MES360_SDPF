-- Remove an archived work order and everything the system holds about it.
--
-- ══ WHY THIS EXISTS ════════════════════════════════════════════════════════
-- Archiving a work order hides it from the list. It does not remove anything,
-- and it does not close what the order left open — which is how a CANCELLED,
-- archived order goes on appearing as the current work on the Live Shift
-- screen, day after day. See the note at the bottom: the screen is reading the
-- data correctly, the data is wrong.
--
-- ══ WHAT IS TARGETED ═══════════════════════════════════════════════════════
-- By default, every work order with `archivedAt` set — the same set the
-- Archived filter shows. Name specific orders instead with
--     -v orders='WO-2026-0009,WO-2026-0010'
-- and archived or not, those and only those go.
--
-- ══ ⚠ THIS IS A DELETE, AND MOST OF IT WOULD NOT CASCADE ═══════════════════
-- The foreign keys were read before this was written, not assumed:
--
--   CASCADE     job_orders, oee_minutes, oee_schedule_minutes,
--               job_order_materials, energy_wo_machine_kpis
--   SET NULL    downtime_events, production_events, material_requests,
--               material_consumptions, batch_records, finished_goods_lots,
--               inspection_results, reschedule_requests, maintenance_wos
--   RESTRICT    scrap_logs, energy_wo_summaries
--   NO KEY      machine_state_records.workOrderId,
--               gateway_counter_states.jobOrderId,
--               machine_current_status.currentWOId
--
-- Relying on the cascade alone would leave the SET NULL rows behind as orphans
-- that still carry the order's downtime and events, and would leave the three
-- unkeyed columns pointing at rows that no longer exist. So each is handled
-- here by name, and the preview counts them all before anything moves.
--
-- RESTRICT is the useful one: if a scrap log or an energy summary references
-- the order, the delete FAILS rather than silently leaving them. Both are
-- empty on this database; the preview says so, and says it again if they ever
-- are not.
--
-- ══ ⚠ THE MACHINE TIMELINE LOSES REAL MINUTES ══════════════════════════════
-- `machine_state_records` carrying the order's id are the machine's own history
-- for the time it ran. On this database that is 56 records spanning 6 Sep
-- 08:35–09:56 — a contained 81 minutes, which is exactly WO-2026-0010's run.
-- Deleting them leaves an 81-minute hole in the timeline for that morning.
--
-- That is what "delete all of its data" means and it is what is done by
-- default. `-v keep_states=1` clears the reference instead, so the machine
-- keeps its history and only the link to the deleted order goes.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f purge-archived-work-orders.sql
--   APPLY:    { cat purge-archived-work-orders.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
--   -v orders='WO-2026-0009,WO-2026-0010'   name them instead of "all archived"
--   -v keep_states=1                        keep the machine timeline, drop the link
--   -v keep_po=1                            leave the production orders standing
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.
-- Take a dump first. There is no undo for this one.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?keep_states}
\else
  \set keep_states 0
\endif
\if :{?orders}
\else
  \set orders ''
\endif
\if :{?keep_po}
\else
  \set keep_po 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The targets ─────────────────────────────────────────────────────────────
-- An empty `orders` means "everything archived". A named list overrides that
-- completely, so naming an order that is NOT archived still removes it — the
-- explicit instruction wins over the default rule.
CREATE TEMP TABLE _wo ON COMMIT DROP AS
SELECT w.id, w."orderNumber", w.status, w."productionOrderId",
       w."archivedAt" IS NOT NULL AS archived
  FROM work_orders w
 WHERE CASE WHEN :'orders' = '' THEN w."archivedAt" IS NOT NULL
            ELSE w."orderNumber" = ANY (string_to_array(:'orders', ',')) END;

CREATE TEMP TABLE _jo ON COMMIT DROP AS
SELECT j.id, j."workOrderId", j."machineId", j.status, j."actualQtyGood", j."actualEnd"
  FROM job_orders j WHERE j."workOrderId" IN (SELECT id FROM _wo);

\echo ''
\echo '1. WORK ORDERS THAT WILL BE DELETED'
SELECT "orderNumber", status, archived FROM _wo ORDER BY "orderNumber";

\echo ''
\echo '2. THEIR JOB ORDERS -- and whether any is still OPEN'
\echo '   An open job order on a cancelled work order is the fault behind the'
\echo '   Live Shift showing it as current work.'
SELECT m.code, j.status, j."actualQtyGood" AS good,
       (j."actualEnd" IS NULL) AS still_open
  FROM _jo j JOIN machines m ON m.id = j."machineId" ORDER BY m.code;

-- ── The production orders behind them ───────────────────────────────────────
-- A production order goes ONLY if every work order it holds is in this delete.
-- One that still has a surviving work order is kept, and named, because
-- removing it would orphan live work to make a tidier list.
CREATE TEMP TABLE _po ON COMMIT DROP AS
SELECT p.id, p."orderNumber", p.status,
       (SELECT count(*) FROM work_orders w
         WHERE w."productionOrderId" = p.id AND w.id NOT IN (SELECT id FROM _wo)) AS survivors
  FROM production_orders p
 WHERE p.id IN (SELECT "productionOrderId" FROM _wo WHERE "productionOrderId" IS NOT NULL);

\echo ''
\echo '3. THEIR PRODUCTION ORDERS'
\echo '   survivors > 0 means the PO holds other work and is KEPT.'
SELECT "orderNumber", status, survivors,
       CASE WHEN survivors = 0 THEN 'delete' ELSE 'keep' END AS verdict
  FROM _po ORDER BY "orderNumber";

\echo ''
\echo '4. EVERY ROW THAT WILL GO'
SELECT 'oee_minutes' AS table_name, count(*) AS rows FROM oee_minutes WHERE "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL SELECT 'oee_schedule_minutes', count(*) FROM oee_schedule_minutes WHERE "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL SELECT 'downtime_events',      count(*) FROM downtime_events WHERE "workOrderId" IN (SELECT id FROM _wo) OR "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL SELECT 'machine_state_records', count(*) FROM machine_state_records WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'production_events',    count(*) FROM production_events WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'material_requests',    count(*) FROM material_requests WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'material_consumptions', count(*) FROM material_consumptions WHERE "workOrderId" IN (SELECT id FROM _wo) OR "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL SELECT 'job_order_materials',  count(*) FROM job_order_materials WHERE "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL SELECT 'batch_records',        count(*) FROM batch_records WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'finished_goods_lots',  count(*) FROM finished_goods_lots WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'inspection_results',   count(*) FROM inspection_results WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'reschedule_requests',  count(*) FROM reschedule_requests WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'energy_wo_machine_kpis', count(*) FROM energy_wo_machine_kpis WHERE "workOrderId" IN (SELECT id FROM _wo)
UNION ALL SELECT 'production_order_stops', count(*) FROM production_order_stops WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0)
UNION ALL SELECT 'schedule_attainment_daily', count(*) FROM schedule_attainment_daily WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0)
UNION ALL SELECT 'job_orders',           count(*) FROM _jo
UNION ALL SELECT 'work_orders',          count(*) FROM _wo
UNION ALL SELECT 'production_orders',    count(*) FROM _po WHERE survivors = 0
ORDER BY 1;

\echo ''
\echo '5. *** RESTRICT — THESE BLOCK THE DELETE IF NOT ZERO ***'
SELECT 'scrap_logs' AS table_name,
       count(*) AS rows FROM scrap_logs
 WHERE "workOrderId" IN (SELECT id FROM _wo) OR "jobOrderId" IN (SELECT id FROM _jo)
UNION ALL
SELECT 'energy_wo_summaries', count(*) FROM energy_wo_summaries WHERE "workOrderId" IN (SELECT id FROM _wo);

\echo ''
\echo '6. THE HOLE THIS LEAVES IN THE MACHINE TIMELINE'
\echo '   keep_states=1 clears the link and keeps these records.'
SELECT m.code, count(*) AS records,
       to_char(MIN(r."startTime") + interval '3 hours', 'MM-DD HH24:MI') AS first_riyadh,
       to_char(MAX(COALESCE(r."endTime", now())) + interval '3 hours', 'MM-DD HH24:MI') AS last_riyadh,
       round(SUM(r."durationMinutes")::numeric, 0) AS minutes
  FROM machine_state_records r JOIN machines m ON m.id = r."machineId"
 WHERE r."workOrderId" IN (SELECT id FROM _wo)
 GROUP BY m.code ORDER BY m.code;

\if :apply

  -- ── Children first, deepest first ─────────────────────────────────────────
  -- Most of these would be reached by a cascade or nulled by the key. They are
  -- deleted BY NAME anyway, because "the order's data is gone" and "the order's
  -- row is gone and its downtime is still on the maintenance report with a null
  -- order" are different outcomes, and only one of them was asked for.
  DELETE FROM oee_minutes           WHERE "jobOrderId" IN (SELECT id FROM _jo);
  DELETE FROM oee_schedule_minutes  WHERE "jobOrderId" IN (SELECT id FROM _jo);
  DELETE FROM job_order_materials   WHERE "jobOrderId" IN (SELECT id FROM _jo);
  DELETE FROM material_consumptions WHERE "workOrderId" IN (SELECT id FROM _wo)
                                       OR "jobOrderId"  IN (SELECT id FROM _jo);
  DELETE FROM downtime_events       WHERE "workOrderId" IN (SELECT id FROM _wo)
                                       OR "jobOrderId"  IN (SELECT id FROM _jo);
  DELETE FROM production_events     WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM material_requests     WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM reschedule_requests   WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM batch_records         WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM finished_goods_lots   WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM inspection_results    WHERE "workOrderId" IN (SELECT id FROM _wo);
  DELETE FROM energy_wo_machine_kpis WHERE "workOrderId" IN (SELECT id FROM _wo);

  -- ── The three columns with no foreign key behind them ─────────────────────
  -- Nothing in the database would have stopped these becoming dangling ids.
  -- `gateway_counter_states` is CLEARED, never deleted: the row holds the
  -- counter's accumulated position, and removing it would make the edge start
  -- again from zero and re-report everything it has already reported.
  UPDATE gateway_counter_states SET "jobOrderId" = NULL
   WHERE "jobOrderId" IN (SELECT id FROM _jo);

  UPDATE machine_current_status SET "currentWOId" = NULL
   WHERE "currentWOId" IN (SELECT id FROM _wo);

  \if :keep_states
    UPDATE machine_state_records SET "workOrderId" = NULL
     WHERE "workOrderId" IN (SELECT id FROM _wo);
  \else
    DELETE FROM machine_state_records WHERE "workOrderId" IN (SELECT id FROM _wo);
  \endif

  -- ── The orders ────────────────────────────────────────────────────────────
  -- A job order can name another as its predecessor, and that key is SET NULL
  -- rather than CASCADE, so a survivor pointing INTO this set is cleared first
  -- rather than left to the key to handle silently.
  UPDATE job_orders SET "predecessorId" = NULL
   WHERE "predecessorId" IN (SELECT id FROM _jo) AND id NOT IN (SELECT id FROM _jo);

  DELETE FROM job_orders  WHERE id IN (SELECT id FROM _jo);
  DELETE FROM work_orders WHERE id IN (SELECT id FROM _wo);

  -- ── The production orders, last ───────────────────────────────────────────
  -- After the work orders, so `survivors` was counted against the set as it
  -- stood BEFORE anything was deleted -- computing it now would find every PO
  -- empty and take the lot. Only those with no surviving work order go.
  \if :keep_po
    \echo ''
    \echo 'keep_po=1 -- production orders left in place.'
  \else
  DELETE FROM material_requests
   WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0);
  DELETE FROM production_order_stops
   WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0);
  DELETE FROM schedule_attainment_daily
   WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0);
  DELETE FROM reschedule_requests
   WHERE "productionOrderId" IN (SELECT id FROM _po WHERE survivors = 0);
  DELETE FROM production_orders
   WHERE id IN (SELECT id FROM _po WHERE survivors = 0);
  \endif

  \echo ''
  \echo 'VERIFY -- nothing left anywhere (every count wants 0)'
  SELECT 'work_orders' AS table_name, count(*) AS remaining FROM work_orders WHERE id IN (SELECT id FROM _wo)
  UNION ALL SELECT 'job_orders',      count(*) FROM job_orders WHERE id IN (SELECT id FROM _jo)
  UNION ALL SELECT 'oee_minutes',     count(*) FROM oee_minutes WHERE "jobOrderId" IN (SELECT id FROM _jo)
  UNION ALL SELECT 'downtime_events', count(*) FROM downtime_events WHERE "workOrderId" IN (SELECT id FROM _wo)
  UNION ALL SELECT 'production_events', count(*) FROM production_events WHERE "workOrderId" IN (SELECT id FROM _wo)
  UNION ALL SELECT 'state_records',   count(*) FROM machine_state_records WHERE "workOrderId" IN (SELECT id FROM _wo)
  UNION ALL SELECT 'production_orders', count(*) FROM production_orders WHERE id IN (SELECT id FROM _po WHERE survivors = 0)
  ORDER BY 1;

  \echo ''
  \echo 'VERIFY -- job orders still open anywhere in the system'
  \echo '   Any row here with a non-EXECUTING work order will haunt the Live'
  \echo '   Shift the same way. Empty is the healthy answer.'
  SELECT w."orderNumber", w.status AS wo_status, m.code, j.status AS jo_status,
         (j."actualStart" + interval '3 hours') AS started_riyadh
    FROM job_orders j
    JOIN work_orders w ON w.id = j."workOrderId"
    JOIN machines m ON m.id = j."machineId"
   WHERE j."actualStart" IS NOT NULL AND j."actualEnd" IS NULL
     AND w.status <> 'IN_PROGRESS'
   ORDER BY w."orderNumber", m.code;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Take a dump before applying. There is no undo for this one.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif

-- ══ THE FAULT BEHIND THE LIVE SHIFT SHOWING A CANCELLED ORDER ══════════════
-- Deleting these two fixes today. The next cancelled order does it again,
-- because the cause is not in the data:
--
--   live-shift.service.ts  jobOrders()
--     actualStart: { not: null, lt: to },
--     OR: [{ actualEnd: null }, { actualEnd: { gt: from } }],
--
-- Any job order that ever STARTED and has no `actualEnd` overlaps every future
-- window forever. There is no condition on the job order's own status, and none
-- on the parent work order's status or `archivedAt`. Cancelling WO-2026-0010
-- left its four job orders PAUSED with a null end, so the screen went on
-- reporting them as the shift's current work — correctly, by its own rule.
--
-- Two things are needed and they are different: the query must exclude orders
-- whose work order is cancelled or archived, and cancelling a work order must
-- close its job orders. This file is neither; it only clears what is already
-- there.
