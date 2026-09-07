-- Write a stated sequence of machine states over a window, and rebuild the
-- production that belongs inside it.
--
-- ══ WHAT THE PLANT STATED ══════════════════════════════════════════════════
-- For 7 Sep 2026, in plant local time:
--
--   IDLE      10:45:00 -> 12:05:00     the break; nothing was made
--   RUNNING   12:05:00 -> 12:55:00     fifty minutes of production
--   STARVED   12:55:00 -> 13:15:00     starved of material
--
-- This is a DECLARED state, not a derived one. The script writes exactly that
-- and nothing else, which is why it replaces the window rather than editing
-- what is in it: editing leaves whatever it did not think to look for, and the
-- point of a declaration is that afterwards the window says only what was
-- declared.
--
-- Re-running is therefore safe and is the way to change your mind: it clears
-- the window and writes the sequence again. The first table supplied started
-- the idle band at 10:33:57 and was corrected to 10:45:00; that correction was
-- one flag, which is what "declare it, do not edit it" buys.
--
-- Whatever sits before `idle_from` is CLIPPED, not deleted. The BLOCKED and
-- BREAKDOWN bands that begin around 10:34 therefore survive, ending at 10:45 —
-- the machines really did stop counting at 10:33, and the declaration does not
-- reach back before its own start.
--
-- ══ ⚠ WHICH MACHINES — READ THIS ═══════════════════════════════════════════
-- The supplied table listed four rows per block, labelled M1, M1, M2, M4. Four
-- rows for a four-machine line reads as M1, M2, M3, M4 with one label mistyped,
-- and that is the default here.
--
-- If you meant only the three machines that carried the long bands, re-run with
--     -v machines='M1,M2,M4'
-- and the window is rewritten for those alone. Nothing is lost by getting this
-- wrong once.
--
-- ══ THE PRODUCTION FIGURE, AND WHERE IT COMES FROM ═════════════════════════
-- Fifty minutes at the order's design speed. `designSpeedPph` on this order is
-- 45 pieces a minute at every step, and the SKU ladder is 1 unit per inner,
-- 4 inners per carton, 40 cartons per pallet — so a pallet is 160 pieces:
--
--   M1  INNER    45.00 / min   ->  2,250 inners
--   M2  CARTON   11.25 / min   ->    563 cartons
--   M3  PALLET    0.281 / min  ->     14 pallets
--   M4  PALLET    0.281 / min  ->     14 pallets
--
-- Design is what "should have been produced" means, and it is what was asked
-- for. It is also OPTIMISTIC on this line: measured over the hour before the
-- stop, M1 ran at 35.08 pieces a minute and M2 at 33.33 — 78% and 74% of
-- design. `-v rate=actual` uses each machine's own measured rate from the two
-- hours before the window instead, which produces a smaller and more defensible
-- number. The preview prints both before anything is written.
--
-- ══ THE TABLES THE EDGE READS ══════════════════════════════════════════════
-- Production is written to four places, because four places carry it:
--
--   oee_minutes             per minute, in PIECES — what every OEE page reads
--   job_orders              the cumulative total, in each step's OWN unit
--   gateway_counter_states  the edge's accumulator
--   machine_current_status  the live tile's running count
--
-- ⚠ The gateway holds `accumulated` in memory and in its own local file, and
-- overwrites the database row on its next flush. Raising the row here only
-- takes effect once the gateway restarts and re-seeds from the database. If
-- this is applied to a live plant, restart the gateway afterwards — otherwise
-- the edge will put its own figure back within the minute.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f rewrite-shift-window.sql
--   APPLY:    { cat rewrite-shift-window.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
--   -v day=2026-09-07            -v machines='M1,M2,M3,M4'
--   -v idle_from='10:45:00'      -v run_from='12:05'
--   -v run_to='12:55'            -v starve_to='13:15'
--   -v rate=design|actual        -v no_production=1   (states only)
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?day}
\else
  \set day '2026-09-07'
\endif
\if :{?machines}
\else
  \set machines 'M1,M2,M3,M4'
\endif
\if :{?idle_from}
\else
  \set idle_from '10:45:00'
\endif
\if :{?run_from}
\else
  \set run_from '12:05:00'
\endif
\if :{?run_to}
\else
  \set run_to '12:55:00'
\endif
\if :{?starve_to}
\else
  \set starve_to '13:15:00'
\endif
\if :{?rate}
\else
  \set rate 'design'
\endif
\if :{?no_production}
\else
  \set no_production 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The window, out of plant time ───────────────────────────────────────────
-- These columns are `timestamp WITHOUT time zone` holding UTC and the plant
-- speaks Riyadh (+03). Typed as bare UTC these bands would land three hours
-- early — on the wrong side of the shift, and still looking plausible.
CREATE TEMP TABLE _t ON COMMIT DROP AS
SELECT ((:'day' || ' ' || :'idle_from')::timestamp  AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t0,
       ((:'day' || ' ' || :'run_from')::timestamp   AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t1,
       ((:'day' || ' ' || :'run_to')::timestamp     AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t2,
       ((:'day' || ' ' || :'starve_to')::timestamp  AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t3;

CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT m.id, m.code, m."factoryId"
  FROM machines m
 WHERE m.code = ANY (string_to_array(:'machines', ','));

-- ── The three bands, as declared ────────────────────────────────────────────
CREATE TEMP TABLE _band ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1, 'IDLE'::"MachineState",    'idle'),
  (2, 'RUNNING'::"MachineState", 'run'),
  (3, 'STARVED'::"MachineState", 'starve')
) AS v(seq, state, tag);

-- ── What each machine should have made per minute, in PIECES ────────────────
-- `oee_minutes.goodParts` counts PIECES; a job order counts INNER, CARTON or
-- PALLET. `per_unit` is the ladder, and it is the only thing standing between
-- "2,250 inners" and "2,250 pallets".
CREATE TEMP TABLE _rate ON COMMIT DROP AS
SELECT m.id AS machine_id, m.code, j.id AS jo_id, j."outputUnit" AS unit,
       (CASE upper(COALESCE(j."outputUnit", ''))
          WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
          WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
          WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
          ELSE 1
        END)::float8 AS per_unit,
       -- Design: the order's own ideal cycle time, expressed in pieces.
       (60.0 / NULLIF(j."idealCycleTimeSec", 0))
         * (CASE upper(COALESCE(j."outputUnit", ''))
              WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
              WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
              WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
              ELSE 1
            END)::float8 AS design_pieces_per_min,
       -- Actual: what this machine really averaged in the two hours before the
       -- window, counting only minutes it produced in. A machine that made
       -- nothing at all has no measured rate and falls back to design.
       COALESCE((
         SELECT AVG(o."goodParts") FROM oee_minutes o
          WHERE o."machineId" = m.id AND o."goodParts" > 0
            AND o."bucketStart" >= (SELECT t0 FROM _t) - interval '2 hours'
            AND o."bucketStart" <  (SELECT t0 FROM _t)
       ), 0)::float8 AS actual_pieces_per_min
  FROM _m m
  JOIN job_orders j ON j."machineId" = m.id AND j.status = 'EXECUTING'
  JOIN work_orders w ON w.id = j."workOrderId"
  LEFT JOIN skus s ON s.id = w."skuId";

CREATE TEMP TABLE _plan ON COMMIT DROP AS
SELECT r.*,
       CASE WHEN lower(:'rate') = 'actual' AND r.actual_pieces_per_min > 0
            THEN r.actual_pieces_per_min ELSE r.design_pieces_per_min END AS pieces_per_min,
       EXTRACT(EPOCH FROM ((SELECT t2 FROM _t) - (SELECT t1 FROM _t))) / 60 AS run_minutes
  FROM _rate r;

\echo ''
\echo '1. THE WINDOW AS DECLARED'
SELECT (t0 + interval '3 hours') AS idle_from, (t1 + interval '3 hours') AS run_from,
       (t2 + interval '3 hours') AS run_to,   (t3 + interval '3 hours') AS starve_to,
       round((EXTRACT(EPOCH FROM (t2 - t1)) / 60)::numeric, 0) AS running_minutes FROM _t;
SELECT string_agg(code, ',' ORDER BY code) AS machines, count(*) AS n FROM _m;

\echo ''
\echo '2. WHAT WILL BE WRITTEN AS PRODUCTION'
\echo '   design = the order ideal cycle time. actual = measured in the 2h before.'
SELECT code, unit, round(per_unit::numeric, 0) AS pieces_per_unit,
       round(design_pieces_per_min::numeric, 2) AS design_per_min,
       round(actual_pieces_per_min::numeric, 2) AS actual_per_min,
       round((pieces_per_min * run_minutes)::numeric, 0) AS pieces_added,
       round((pieces_per_min * run_minutes / per_unit)::numeric, 0) AS units_added
  FROM _plan ORDER BY code;

\echo ''
\echo '3. WHERE THOSE UNITS LAND'
SELECT p.code, j."actualQtyGood" AS job_order_now,
       round((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0) AS added,
       j."actualQtyGood" + round((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0) AS job_order_after,
       g.accumulated AS edge_now,
       g.accumulated + round((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0) AS edge_after
  FROM _plan p
  JOIN job_orders j ON j.id = p.jo_id
  LEFT JOIN tag_definitions t ON t."machineId" = p.machine_id AND t."counterRole" = 'GOOD' AND t."isActive"
  LEFT JOIN gateway_counter_states g ON g."tagId" = t.id
 ORDER BY p.code;

\echo ''
\echo '4. WHAT IS IN THE WINDOW NOW, AND WILL BE REPLACED'
SELECT m.code, r.state, count(*) AS records,
       round(SUM(r."durationMinutes")::numeric, 0) AS minutes
  FROM machine_state_records r JOIN _m m ON m.id = r."machineId" CROSS JOIN _t t
 WHERE r."startTime" < t.t3 AND COALESCE(r."endTime", timestamp '9999-12-31') > t.t0
 GROUP BY m.code, r.state ORDER BY m.code, r.state;

\if :apply

  -- ── 1. Clear the window, without disturbing what lies outside it ──────────
  -- Three steps, because a record can start before the window, end after it,
  -- or sit inside. Truncating the stragglers first means the delete only ever
  -- removes rows that are wholly inside, and no time outside the window
  -- changes meaning.
  UPDATE machine_state_records r
     SET "endTime" = t.t0,
         "durationMinutes" = EXTRACT(EPOCH FROM (t.t0 - r."startTime")) / 60,
         notes = concat_ws(' ', r.notes, '[clipped: the window after this was restated]')
    FROM _t t
   WHERE r."machineId" IN (SELECT id FROM _m)
     AND r."startTime" < t.t0
     AND COALESCE(r."endTime", timestamp '9999-12-31') > t.t0;

  UPDATE machine_state_records r
     SET "startTime" = t.t3,
         "durationMinutes" = CASE WHEN r."endTime" IS NULL THEN NULL
                                  ELSE EXTRACT(EPOCH FROM (r."endTime" - t.t3)) / 60 END,
         notes = concat_ws(' ', r.notes, '[clipped: the window before this was restated]')
    FROM _t t
   WHERE r."machineId" IN (SELECT id FROM _m)
     AND r."startTime" >= t.t0 AND r."startTime" < t.t3
     AND COALESCE(r."endTime", timestamp '9999-12-31') > t.t3;

  DELETE FROM machine_state_records r
   USING _t t
   WHERE r."machineId" IN (SELECT id FROM _m)
     AND r."startTime" >= t.t0
     AND COALESCE(r."endTime", timestamp '9999-12-31') <= t.t3;

  -- ── 2. The three declared bands ───────────────────────────────────────────
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", state, "startTime", "endTime", "durationMinutes",
     "isPlannedStop", "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, m."factoryId", m.id, b.state,
         CASE b.seq WHEN 1 THEN t.t0 WHEN 2 THEN t.t1 ELSE t.t2 END,
         CASE b.seq WHEN 1 THEN t.t1 WHEN 2 THEN t.t2 ELSE t.t3 END,
         EXTRACT(EPOCH FROM (
           CASE b.seq WHEN 1 THEN t.t1 WHEN 2 THEN t.t2 ELSE t.t3 END
         - CASE b.seq WHEN 1 THEN t.t0 WHEN 2 THEN t.t1 ELSE t.t2 END)) / 60,
         false, NULL,
         '[stated by the plant: ' || b.state::text || ' for this window]',
         'MANUAL'
    FROM _m m CROSS JOIN _t t CROSS JOIN _band b;

  -- ── 3. Downtime events must not contradict the bands ──────────────────────
  -- Any unplanned event overlapping the window is trimmed out of it. IDLE and
  -- RUNNING are not downtime, and the STARVED band is written below as its own
  -- event rather than by stretching whatever happened to be nearby.
  DELETE FROM downtime_events d
   USING _t t
   WHERE d."machineId" IN (SELECT id FROM _m)
     AND NOT d."isPlanned"
     AND d."startTime" >= t.t0
     AND COALESCE(d."endTime", timestamp '9999-12-31') <= t.t3;

  UPDATE downtime_events d
     SET "endTime" = t.t0,
         "durationMinutes" = EXTRACT(EPOCH FROM (t.t0 - d."startTime")) / 60,
         reason = concat_ws(' ', d.reason, '[clipped: the window after this was restated]'),
         "updatedAt" = now()
    FROM _t t
   WHERE d."machineId" IN (SELECT id FROM _m)
     AND NOT d."isPlanned"
     AND d."startTime" < t.t0
     AND COALESCE(d."endTime", timestamp '9999-12-31') > t.t0;

  INSERT INTO downtime_events
    (id, "factoryId", "machineId", reason, category, "reasonCode",
     "startTime", "endTime", "durationMinutes", "affectsOEE", "isPlanned",
     acknowledged, "updatedAt")
  SELECT gen_random_uuid()::text, m."factoryId", m.id,
         'Starved — stated by the plant', 'MATERIAL'::"DowntimeCategory", 'STARVED'::"DowntimeReasonCode",
         t.t2, t.t3, EXTRACT(EPOCH FROM (t.t3 - t.t2)) / 60,
         -- Starvation is an EXTERNAL loss: the machine was fit to run and had
         -- nothing to run on. It leaves the availability denominator rather
         -- than counting against the machine, which is the whole distinction
         -- between STARVED and BREAKDOWN.
         false, false, false, now()
    FROM _m m CROSS JOIN _t t;

  -- ── 4. The minutes ────────────────────────────────────────────────────────
  -- Every minute in the window is reclassified first, so nothing is left
  -- holding the old story, and production is then written only into the
  -- running band.
  --
  -- Only the EXECUTING order's rows are touched. WO-2026-0010 has been PAUSED
  -- since 6 Sep and books a planned-stop minute for every machine every minute;
  -- writing production onto those rows would credit a paused order and hide
  -- that problem at the same time.
  UPDATE oee_minutes o
     SET "machineState" = 'IDLE', "operatingMin" = 0, "availabilityLossMin" = 0,
         "externalLossMin" = 0, "unmeasuredMin" = 0, "plannedStopMin" = 0,
         "goodParts" = 0, "rejectedParts" = 0
    FROM _t t, _plan p
   WHERE o."jobOrderId" = p.jo_id
     AND o."bucketStart" >= t.t0 AND o."bucketStart" < t.t1;

  UPDATE oee_minutes o
     SET "machineState" = 'STARVED', "operatingMin" = 0, "availabilityLossMin" = 0,
         "externalLossMin" = o."totalMin", "unmeasuredMin" = 0, "plannedStopMin" = 0,
         "goodParts" = 0, "rejectedParts" = 0
    FROM _t t, _plan p
   WHERE o."jobOrderId" = p.jo_id
     AND o."bucketStart" >= t.t2 AND o."bucketStart" < t.t3;

  UPDATE oee_minutes o
     SET "machineState" = 'RUNNING',
         "operatingMin" = o."totalMin", "availabilityLossMin" = 0,
         "externalLossMin" = 0, "unmeasuredMin" = 0, "plannedStopMin" = 0,
         "goodParts" = CASE WHEN :no_production <> 0 THEN o."goodParts" ELSE p.pieces_per_min END,
         "rejectedParts" = 0,
         "theoreticalParts" = p.design_pieces_per_min
    FROM _t t, _plan p
   WHERE o."jobOrderId" = p.jo_id
     AND o."bucketStart" >= t.t1 AND o."bucketStart" < t.t2;

  \if :no_production
    \echo ''
    \echo 'no_production=1 — states rewritten, counts left alone.'
  \else

  -- ── 5. The cumulative counters ────────────────────────────────────────────
  -- Rounded, because a job order cannot hold 562.5 cartons.
  UPDATE job_orders j
     SET "actualQtyGood" = j."actualQtyGood"
                         + ROUND((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0),
         notes = concat_ws(' ', j.notes,
           '[+' || ROUND((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0) || ' '
                || COALESCE(j."outputUnit", 'unit') || ' reconstructed at '
                || lower(:'rate') || ' rate for ' || :'run_from' || '-' || :'run_to' || ']')
    FROM _plan p
   WHERE j.id = p.jo_id;

  -- The edge's accumulator, so a gateway restart re-seeds from a figure that
  -- agrees with the job order instead of re-reporting the gap.
  UPDATE gateway_counter_states g
     SET accumulated = g.accumulated
                     + ROUND((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0)
    FROM _plan p, tag_definitions t
   WHERE t.id = g."tagId"
     AND t."machineId" = p.machine_id
     AND t."counterRole" = 'GOOD'
     AND t."isActive";

  UPDATE machine_current_status s
     SET "goodCount" = s."goodCount"
                     + ROUND((p.pieces_per_min * p.run_minutes / p.per_unit)::numeric, 0)::int
    FROM _plan p
   WHERE s."machineId" = p.machine_id;

  \endif

  \echo ''
  \echo 'RESULT -- the window now reads'
  SELECT m.code, r.state,
         (r."startTime" + interval '3 hours') AS riyadh_from,
         (r."endTime"   + interval '3 hours') AS riyadh_to,
         round(r."durationMinutes"::numeric, 1) AS minutes
    FROM machine_state_records r JOIN _m m ON m.id = r."machineId" CROSS JOIN _t t
   WHERE r."startTime" >= t.t0 AND r."startTime" < t.t3
   ORDER BY m.code, r."startTime";

  \echo ''
  \echo 'VERIFY -- production booked per machine, and the stores agree'
  SELECT p.code, p.unit,
         round(SUM(o."goodParts")::numeric, 0) AS pieces_in_minutes,
         round((SUM(o."goodParts") / p.per_unit)::numeric, 1) AS units_in_minutes,
         j."actualQtyGood" AS job_order_total,
         g.accumulated AS edge_accumulated
    FROM _plan p
    JOIN oee_minutes o ON o."jobOrderId" = p.jo_id
    CROSS JOIN _t t
    JOIN job_orders j ON j.id = p.jo_id
    LEFT JOIN tag_definitions tg ON tg."machineId" = p.machine_id AND tg."counterRole" = 'GOOD' AND tg."isActive"
    LEFT JOIN gateway_counter_states g ON g."tagId" = tg.id
   WHERE o."bucketStart" >= t.t1 AND o."bucketStart" < t.t2
   GROUP BY p.code, p.unit, p.per_unit, j."actualQtyGood", g.accumulated
   ORDER BY p.code;

  \echo ''
  \echo 'VERIFY -- no state left in the window other than the three declared'
  SELECT DISTINCT r.state FROM machine_state_records r
    JOIN _m m ON m.id = r."machineId" CROSS JOIN _t t
   WHERE r."startTime" >= t.t0 AND r."startTime" < t.t3;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'On a LIVE plant, restart the gateway so it re-seeds `accumulated`.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Check the machine list in section 1 before applying.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
