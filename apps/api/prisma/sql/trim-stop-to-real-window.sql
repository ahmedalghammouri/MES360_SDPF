-- Trim a recorded stop back to the window the stop actually happened in, and
-- say what the rest of it really was.
--
-- ══ WHAT THE PLANT REPORTED ════════════════════════════════════════════════
-- On 7 Sep 2026 three machines show one enormous stop, and the real one was
-- much shorter:
--
--   M1  BLOCKED    10:34:41 -> 15:05:37 Riyadh   270.9 min
--   M2  BREAKDOWN  10:33:57 -> 15:05:36 Riyadh   271.6 min
--   M4  STARVED    10:56:19 -> 15:05:36 Riyadh   249.3 min
--
-- ══ WHAT THE MEASUREMENT FOUND, WHICH IS NOT A STOP ════════════════════════
-- The three bands end within ONE SECOND of each other. Three machines do not
-- resume in the same second; one process does.
--
-- `energy_readings` is written by a completely separate path -- no counters, no
-- state engine -- and it stops too:
--
--   hour   rows   covering
--   11:00   334   the full hour
--   12:00   103   eighteen minutes, then nothing
--   13:00     0
--   14:00     0
--   15:00    26   resumed
--
-- And on resuming, M3 booked 2,880 pieces into the single 15:05 minute against
-- a ceiling near 40 a minute -- a held backlog paid out at once.
--
-- So from about 12:18 the gateway was NOT WATCHING. The bands did not continue
-- because the machines stayed stopped; they continued because nothing arrived
-- to end them. That time is unmeasured, and it is neither a stop nor running.
--
-- ══ WHICH PART OF THE BAND IS ACTUALLY WRONG ═══════════════════════════════
-- Production per minute ran steadily at ~44 until 10:33 and ceased there, with
-- nothing at all until 15:05. So:
--
--   the START of each band is right     -- the line really did stop at ~10:34
--   the END is wrong                    -- 12:05 onward is blindness, not a stop
--
-- The head is therefore NOT trimmed by default. Writing 10:34-10:45 back to
-- RUNNING would put eleven minutes of running with zero output into the
-- record, which reads as a performance collapse that never happened. Pass
-- `-v trim_head=1` to move the start to `from_local` anyway -- worth doing if
-- you know the line was running and the counters missed it, which on this
-- plant is not a remote possibility.
--
-- ══ WHY THE TAIL BECOMES OFFLINE AND NOT RUNNING ═══════════════════════════
-- OFFLINE with the minutes booked as `unmeasuredMin` takes the period OUT of
-- the OEE denominator rather than scoring it. RUNNING would claim three hours
-- of production time that produced nothing; BREAKDOWN claims a fault nobody
-- diagnosed. Neither is true, and both are louder than the truth, which is
-- that the system has no reading for those hours.
--
--   -v tail=offline    (default)  unmeasured -- out of the denominator
--   -v tail=running               claims the line ran; only if you know it did
--   -v tail=idle                  claims only that it was not broken
--
-- ══ WHAT THIS DOES NOT TOUCH ═══════════════════════════════════════════════
-- Two work orders are open on every machine at once: WO-2026-0010 has been
-- PAUSED since 6 Sep 08:35 and never closed, and books a PLANNED STOP minute
-- for every machine every minute for as long as it stays open. That is why
-- `oee_minutes` holds two rows per machine per minute here. It is real and it
-- is bigger than this window; closing a work order is not a repair to a stop
-- band, so it is deliberately out of scope. See close-forgotten-job-orders.sql.
--
-- The 2,880-piece minute on M3 at 15:05 is also left alone. It is a counting
-- fault, not a time-classification one, and rescale-double-counted-order.sql
-- is the tool for it.
--
-- M3 is left alone by default: it shows one open RUNNING record from 10:40 and
-- produced nothing through the break, so it claims to have run through a stop
-- the rest of the line took. The plant named the BLOCKED and BREAKDOWN
-- machines, not this one. `-v with_m3=1` includes it.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f trim-stop-to-real-window.sql
--   APPLY:    { cat trim-stop-to-real-window.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
--   -v day=2026-09-07     -v from_local='10:45'   -v to_local='12:05'
--   -v tail=offline|running|idle    -v trim_head=1    -v planned=1   -v with_m3=1
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
\if :{?from_local}
\else
  \set from_local '10:45'
\endif
\if :{?to_local}
\else
  \set to_local '12:05'
\endif
\if :{?tail}
\else
  \set tail 'offline'
\endif
\if :{?trim_head}
\else
  \set trim_head 0
\endif
\if :{?planned}
\else
  \set planned 0
\endif
\if :{?with_m3}
\else
  \set with_m3 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The window, converted out of plant time ─────────────────────────────────
-- These columns are `timestamp WITHOUT time zone` holding UTC and the plant
-- speaks Riyadh (+03). A bare UTC window would trim the wrong ninety minutes
-- silently, because the result would still look like a plausible break.
CREATE TEMP TABLE _w ON COMMIT DROP AS
SELECT ((:'day' || ' ' || :'from_local')::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS f,
       ((:'day' || ' ' || :'to_local')::timestamp   AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t;

CREATE TEMP TABLE _opt ON COMMIT DROP AS
SELECT (CASE lower(:'tail')
          WHEN 'running' THEN 'RUNNING'
          WHEN 'idle'    THEN 'IDLE'
          ELSE                'OFFLINE'
        END)::"MachineState" AS tail_state,
       (lower(:'tail') NOT IN ('running', 'idle')) AS tail_unmeasured,
       (:trim_head <> 0) AS cut_head,
       (:planned   <> 0) AS as_planned,
       (:with_m3   <> 0) AS do_m3;

-- ── The bands to correct ────────────────────────────────────────────────────
-- Chosen by OVERLAP and by being longer than the true window, not from a list
-- of ids: ids differ between databases, and a criterion can be argued with.
-- `body_from` is where the stop is allowed to begin -- the band's own start
-- unless the head is being cut.
CREATE TEMP TABLE _band ON COMMIT DROP AS
SELECT r.*, m.code,
       CASE WHEN o.cut_head THEN GREATEST(r."startTime", w.f) ELSE r."startTime" END AS body_from
  FROM machine_state_records r
  JOIN machines m ON m.id = r."machineId"
  CROSS JOIN _w w
  CROSS JOIN _opt o
 WHERE r."startTime" < w.t
   AND COALESCE(r."endTime", timestamp '9999-12-31') > w.f
   AND r."durationMinutes" > EXTRACT(EPOCH FROM (w.t - w.f)) / 60
   AND (r.state IN ('BLOCKED', 'BREAKDOWN', 'STARVED') OR (o.do_m3 AND r.state = 'RUNNING'));

\echo ''
\echo '1. THE WINDOW AND THE CHOICES'
SELECT :'day' AS plant_day, :'from_local' AS riyadh_from, :'to_local' AS riyadh_to,
       f AS utc_from, t AS utc_to,
       round((EXTRACT(EPOCH FROM (t - f)) / 60)::numeric, 0) AS true_minutes FROM _w;
SELECT tail_state AS tail_becomes, tail_unmeasured AS tail_left_out_of_oee,
       cut_head AS head_trimmed, as_planned AS break_is_planned, do_m3 AS m3_included FROM _opt;

\echo ''
\echo '2. BANDS THAT WILL BE TRIMMED'
SELECT code, state,
       (b."startTime" + interval '3 hours') AS riyadh_start,
       (b."endTime"   + interval '3 hours') AS riyadh_end,
       round(b."durationMinutes"::numeric, 1) AS minutes_now,
       round((EXTRACT(EPOCH FROM (LEAST(COALESCE(b."endTime", w.t), w.t) - b.body_from)) / 60)::numeric, 1) AS stop_after,
       round((EXTRACT(EPOCH FROM (b.body_from - b."startTime")) / 60)::numeric, 1) AS freed_head,
       round((EXTRACT(EPOCH FROM (COALESCE(b."endTime", w.t) - LEAST(COALESCE(b."endTime", w.t), w.t))) / 60)::numeric, 1) AS freed_tail
  FROM _band b CROSS JOIN _w w ORDER BY code;

\echo ''
\echo '3. *** WHAT THE COUNTERS SAW -- READ THIS BEFORE APPLYING ***'
\echo '    30 minutes before the stop, during it, and the three hours after.'
SELECT m.code,
       round(SUM(o."goodParts") FILTER (WHERE o."bucketStart" >= w.f - interval '30 min'
                                          AND o."bucketStart" <  w.f)::numeric, 0) AS half_hour_before,
       round(SUM(o."goodParts") FILTER (WHERE o."bucketStart" >= w.f
                                          AND o."bucketStart" <  w.t)::numeric, 0) AS during,
       round(SUM(o."goodParts") FILTER (WHERE o."bucketStart" >= w.t
                                          AND o."bucketStart" <  w.t + interval '3 hours')::numeric, 0) AS three_hours_after
  FROM oee_minutes o JOIN machines m ON m.id = o."machineId" CROSS JOIN _w w
 WHERE o."bucketStart" >= w.f - interval '30 min' AND o."bucketStart" < w.t + interval '3 hours'
 GROUP BY m.code ORDER BY m.code;

\echo ''
\echo '   Zero in the last column on every machine is the gateway being blind,'
\echo '   not the line being stopped. That is what tail=offline records.'

\if :apply

  -- ── 1. The body: the stop as it really was ────────────────────────────────
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop",
     "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, b."factoryId", b."machineId", b."shiftInstanceId",
         b."workOrderId", b."skuId",
         CASE WHEN o.as_planned THEN 'PLANNED_STOP'::"MachineState" ELSE b.state END,
         b.body_from, LEAST(COALESCE(b."endTime", w.t), w.t),
         EXTRACT(EPOCH FROM (LEAST(COALESCE(b."endTime", w.t), w.t) - b.body_from)) / 60,
         o.as_planned,
         CASE WHEN o.as_planned THEN NULL ELSE b."downtimeCauseId" END,
         concat_ws(' ', b.notes, '[stop trimmed to ' || :'to_local' || ' plant time]'),
         b.source
    FROM _band b CROSS JOIN _w w CROSS JOIN _opt o
   WHERE LEAST(COALESCE(b."endTime", w.t), w.t) > b.body_from;

  -- ── 2. The head, only when asked for ──────────────────────────────────────
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop",
     "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, b."factoryId", b."machineId", b."shiftInstanceId",
         b."workOrderId", b."skuId",
         'RUNNING'::"MachineState", b."startTime", b.body_from,
         EXTRACT(EPOCH FROM (b.body_from - b."startTime")) / 60,
         false, NULL,
         concat_ws(' ', b.notes, '[was ' || b.state::text || ' - the stop had not started yet]'),
         b.source
    FROM _band b
   WHERE b.body_from > b."startTime";

  -- ── 3. The tail: time the system was not watching ─────────────────────────
  -- The original state is kept in the notes. Nothing here claims to know what
  -- the machine was doing, because nothing does.
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop",
     "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, b."factoryId", b."machineId", b."shiftInstanceId",
         CASE WHEN o.tail_unmeasured THEN NULL ELSE b."workOrderId" END,
         b."skuId",
         o.tail_state, w.t, b."endTime",
         CASE WHEN b."endTime" IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (b."endTime" - w.t)) / 60 END,
         false, NULL,
         concat_ws(' ', b.notes,
           '[was ' || b.state::text || ' - the stop had ended; no readings arrived until the gateway returned]'),
         b.source
    FROM _band b CROSS JOIN _w w CROSS JOIN _opt o
   WHERE COALESCE(b."endTime", timestamp '9999-12-31') > w.t;

  DELETE FROM machine_state_records WHERE id IN (SELECT id FROM _band);

  -- ── 4. The downtime events that mirror those bands ────────────────────────
  -- Trimmed, not split. A downtime event is one episode with one cause; the
  -- tail is not a shorter episode of the same fault, it is time that was never
  -- downtime at all.
  UPDATE downtime_events d
     SET "startTime" = GREATEST(d."startTime", (SELECT MIN(body_from) FROM _band b WHERE b."machineId" = d."machineId")),
         "endTime" = LEAST(COALESCE(d."endTime", w.t), w.t),
         "durationMinutes" = EXTRACT(EPOCH FROM (LEAST(COALESCE(d."endTime", w.t), w.t)
                                               - GREATEST(d."startTime", (SELECT MIN(body_from) FROM _band b WHERE b."machineId" = d."machineId")))) / 60,
         reason = concat_ws(' ', d.reason, '[trimmed: the rest was unmeasured, not downtime]'),
         "updatedAt" = now()
    FROM _w w
   WHERE d."machineId" IN (SELECT "machineId" FROM _band)
     AND d."startTime" < w.t
     AND COALESCE(d."endTime", timestamp '9999-12-31') > w.f
     AND COALESCE(d."durationMinutes", 1e9) > EXTRACT(EPOCH FROM (w.t - w.f)) / 60
     AND NOT d."isPlanned";

  -- ── 5. The minute store follows ───────────────────────────────────────────
  -- The head, when it was cut: loss becomes operating time.
  UPDATE oee_minutes o
     SET "machineState" = 'RUNNING',
         "operatingMin" = o."operatingMin" + o."availabilityLossMin" + o."externalLossMin",
         "availabilityLossMin" = 0, "externalLossMin" = 0
    FROM _w w, _opt opt
   WHERE opt.cut_head
     AND o."machineId" IN (SELECT "machineId" FROM _band)
     AND o."bucketStart" >= (SELECT MIN("startTime") FROM _band)
     AND o."bucketStart" <  w.f
     AND o."machineState" IN ('BLOCKED', 'BREAKDOWN', 'STARVED');

  -- The tail. `unmeasuredMin` is the whole point: those minutes leave the OEE
  -- denominator instead of being scored as a loss the plant never suffered or
  -- as production time that made nothing. `goodParts` is never altered --
  -- whatever was counted was counted, and this script corrects the
  -- classification of TIME, not quantity.
  UPDATE oee_minutes o
     SET "machineState" = opt.tail_state::text,
         "unmeasuredMin" = CASE WHEN opt.tail_unmeasured
                                THEN o."unmeasuredMin" + o."availabilityLossMin" + o."externalLossMin"
                                ELSE o."unmeasuredMin" END,
         "operatingMin"  = CASE WHEN opt.tail_unmeasured THEN o."operatingMin"
                                ELSE o."operatingMin" + o."availabilityLossMin" + o."externalLossMin" END,
         "availabilityLossMin" = 0, "externalLossMin" = 0
    FROM _w w, _opt opt
   WHERE o."machineId" IN (SELECT "machineId" FROM _band)
     AND o."bucketStart" >= w.t
     AND o."bucketStart" <  (SELECT MAX(COALESCE("endTime", now())) FROM _band)
     AND o."machineState" IN ('BLOCKED', 'BREAKDOWN', 'STARVED');

  \echo ''
  \echo 'RESULT -- the bands as they now stand'
  SELECT m.code, r.state,
         (r."startTime" + interval '3 hours') AS riyadh_start,
         (r."endTime"   + interval '3 hours') AS riyadh_end,
         round(r."durationMinutes"::numeric, 1) AS minutes
    FROM machine_state_records r JOIN machines m ON m.id = r."machineId"
   WHERE r.notes LIKE '%stop trimmed to%' OR r.notes LIKE '%the stop had%'
   ORDER BY m.code, r."startTime";

  \echo ''
  \echo 'VERIFY -- no stopped band survives past the end of the window (want 0 rows)'
  -- The invariant is "nothing stopped EXTENDS past w.t", not "nothing is
  -- longer than the window". The first draft tested the length and flagged the
  -- correct bodies themselves: with the head left in place M1 runs 10:34-12:05,
  -- which is 90 minutes against an 80-minute window and entirely right.
  SELECT m.code, r.state,
         (r."endTime" + interval '3 hours') AS ends_riyadh,
         round(r."durationMinutes"::numeric, 1) AS minutes
    FROM machine_state_records r JOIN machines m ON m.id = r."machineId" CROSS JOIN _w w
   WHERE r.state IN ('BLOCKED', 'BREAKDOWN', 'STARVED')
     AND r."startTime" < w.t
     AND COALESCE(r."endTime", timestamp '9999-12-31') > w.t;

  \echo ''
  \echo 'VERIFY -- unplanned downtime charged on this day, per machine'
  SELECT m.code, round(SUM(d."durationMinutes")::numeric, 1) AS unplanned_min, count(*) AS events
    FROM downtime_events d JOIN machines m ON m.id = d."machineId"
   WHERE d."startTime" >= ((:'day' || ' 00:00')::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc'
     AND d."startTime" <  (((:'day' || ' 00:00')::timestamp + interval '1 day') AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc'
     AND NOT d."isPlanned"
   GROUP BY m.code ORDER BY m.code;

  \echo ''
  \echo 'VERIFY -- minutes now left out of the OEE denominator'
  SELECT m.code, round(SUM(o."unmeasuredMin")::numeric, 0) AS unmeasured_min
    FROM oee_minutes o JOIN machines m ON m.id = o."machineId" CROSS JOIN _w w
   WHERE o."bucketStart" >= w.t AND o."bucketStart" < w.t + interval '4 hours'
   GROUP BY m.code ORDER BY m.code;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
