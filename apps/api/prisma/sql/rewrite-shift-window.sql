-- Write a stated sequence of machine states over a window, and rebuild the
-- production that belongs inside it.
--
-- ══ WHAT THE PLANT STATED, 7 Sep 2026 ══════════════════════════════════════
-- Edit the sequence in `_seq` below and nowhere else. Everything derives from
-- it: the window is its first start to its last end, and production is written
-- into every RUNNING band it contains.
--
--   band            M1          M2           M3         M4
--   10:45 - 12:05   BLOCKED     BREAKDOWN    STARVED    STARVED
--   12:05 - 12:55   IDLE        IDLE         IDLE       IDLE
--   12:55 - 13:15   STARVED     STARVED      STARVED    STARVED
--   13:15 - 15:06   RUNNING     RUNNING      RUNNING    RUNNING
--
-- The first band differs PER MACHINE, so `_seq` carries a machine column. `*`
-- means every machine in scope; a code names one.
--
-- This is a DECLARATION, not a derivation. The script clears the window and
-- writes the sequence, rather than hunting down whatever is already in it.
-- Editing leaves behind what it did not think to look for; declaring means the
-- window afterwards says only what was declared.
--
-- ══ RE-RUNNING IS THE WAY TO CHANGE YOUR MIND ══════════════════════════════
-- Idempotent in both halves, and the second half was not, at first.
--
-- The STATES were always safe: the window is cleared and rewritten, so running
-- twice leaves what running once leaves.
--
-- The PRODUCTION was not. It read `actualQtyGood + added`, so a second run
-- added the same output again. That is a poor property for a script whose whole
-- design is "run it again with a different number" -- the first table supplied
-- began at 10:33:57 and was corrected to 10:45, and this band sequence has
-- already grown by one row since.
--
-- So production is now settled by DIFFERENCE. The script measures what the
-- window holds before it touches anything, writes the minutes, measures again,
-- and moves the cumulative counters by new minus old. Run it twice and the
-- second difference is zero. Correct a band and only the correction moves.
--
-- ══ ⚠ HOW THE MACHINE LABELS WERE READ ═════════════════════════════════════
-- The supplied table labels its four rows M1, M1, M2, M4 in every block. Read
-- literally that is three machines with one duplicated; read as M1, M2, M3, M4
-- it is the whole line. The first band settles it, because its states are not
-- uniform and they line up exactly with what was MEASURED on the day:
--
--   stated        blocked   breakdown   starved   starved
--   measured      M1 BLOCKED   M2 BREAKDOWN   (M3 none)   M4 STARVED
--
-- `blocked` sits on M1 and `breakdown` on M2 in the measured data, in that
-- order, which is the order the table lists them. So the rows are M1, M2, M3,
-- M4 and the labels slipped by one. M3 -- the machine that recorded nothing at
-- all through the stop -- takes `starved`.
--
-- If that reading is wrong, correct the `_seq` rows directly; they name their
-- machine. Nothing is lost by getting it wrong once.
--
-- ══ THE PRODUCTION FIGURE ══════════════════════════════════════════════════
-- PRODUCTION IS WRITTEN INTO RUNNING BANDS AND NOWHERE ELSE. That is the whole
-- rule, and it is why the figure moved: the 12:05-12:55 band was RUNNING in the
-- previous statement and is IDLE in this one, so those fifty minutes now make
-- nothing. One running band remains, 13:15-15:06.
--
-- ── AND A RECONSTRUCTED FIGURE IS STILL A GUESS ────────────────────────────
-- Everything below computes what a machine SHOULD have made. That is a model,
-- not a measurement, and on this line the model is 25% optimistic. If the real
-- output will be known at end of shift and entered by hand, `-v rate=none` is
-- the better answer: it leaves the window holding no production at all and
-- reverses anything an earlier run put there, so the hand-entered figure lands
-- on an empty window instead of on top of an estimate.
--
-- Design speed on this order is 45 pieces a minute at every step, and the SKU
-- ladder is 1 unit per inner, 4 inners per carton, 40 cartons per pallet -- so
-- a pallet is 160 pieces. Over the 111 running minutes above:
--
--   M1  INNER   4,995     M2  CARTON  1,249     M3/M4  PALLET  31
--
-- Design is what "should have produced" means and is what was asked for. It is
-- also optimistic here: M1 measured 35.08 pieces a minute and M2 33.33 in the
-- hours before the stop, 78% and 74% of design. `-v rate=actual` uses each
-- machine's own measured rate instead. The preview prints both.
--
-- ══ THE TABLES THE EDGE READS ══════════════════════════════════════════════
--   oee_minutes             per minute, in PIECES -- what every OEE page reads
--   job_orders              the cumulative total, in each step's OWN unit
--   gateway_counter_states  the edge's accumulator
--   machine_current_status  the live tile's running count
--
-- ⚠ The gateway holds `accumulated` in memory and in its own local file and
-- overwrites the database row on its next flush. Raising the row here takes
-- effect only once the gateway restarts and re-seeds. On a live plant, restart
-- it afterwards or the edge will put its own figure back within the minute.
--
-- ══ WHAT IS LEFT ALONE ═════════════════════════════════════════════════════
-- Planned stops. The shift plan's "Lunch Break" and "Cleaning after" bars are
-- the PLAN, drawn on their own track; this script restates what was MEASURED.
-- A declaration that the line ran through a planned clean is a real thing to
-- say, and the gap between the two tracks is exactly what a plant wants to see
-- rather than have quietly closed.
--
-- Time outside the window is CLIPPED, not deleted, so the BLOCKED and BREAKDOWN
-- bands beginning around 10:34 survive and end at the window's start. The
-- counters really did stop at 10:33.
--
-- Only the EXECUTING order's minutes are touched. WO-2026-0010 has been PAUSED
-- since 6 Sep and books a planned-stop minute for every machine every minute;
-- writing production onto those rows would credit a paused order and bury that
-- problem in the same stroke.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f rewrite-shift-window.sql
--   APPLY:    { cat rewrite-shift-window.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
--   -v day=2026-09-07   -v machines='M1,M2,M3,M4'
--   -v rate=design|actual|none   -v no_production=1
--
--   rate=none          the window holds NO production. The running bands are
--                      written as running and produce nothing, and the
--                      cumulative counters are reversed by exactly what the
--                      window held -- so a figure reconstructed by an earlier
--                      run is removed rather than left behind. Use this when
--                      the real output will be entered by hand at end of shift.
--
--   no_production=1    a different thing: the states are rewritten and the
--                      counts are not touched AT ALL. Whatever production the
--                      window already holds stays exactly as it is.
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

-- ── THE SEQUENCE — EDIT HERE AND NOWHERE ELSE ───────────────────────────────
-- Plant local time. The bands must be contiguous and in order; the preview
-- checks both and refuses to run on a gap or an overlap.
CREATE TEMP TABLE _seq ON COMMIT DROP AS
SELECT seq, machine, state::"MachineState" AS state,
       ((:'day' || ' ' || from_local)::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t_from,
       ((:'day' || ' ' || to_local)::timestamp   AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t_to,
       from_local, to_local
FROM (VALUES
  -- The break: each machine stopped for its own reason, as measured.
  (1, '10:45:00', '12:05:00', 'M1', 'BLOCKED'),
  (1, '10:45:00', '12:05:00', 'M2', 'BREAKDOWN'),
  (1, '10:45:00', '12:05:00', 'M3', 'STARVED'),
  (1, '10:45:00', '12:05:00', 'M4', 'STARVED'),
  -- The rest is line-wide. `*` is every machine in scope.
  (2, '12:05:00', '12:55:00', '*',  'IDLE'),
  (3, '12:55:00', '13:15:00', '*',  'STARVED'),
  (4, '13:15:00', '15:06:00', '*',  'RUNNING')
) AS v(seq, from_local, to_local, machine, state);

-- The window is the sequence's own extent. Nothing else defines it, so adding
-- a band cannot leave the clipping and the writing disagreeing about where the
-- window ends.
CREATE TEMP TABLE _span ON COMMIT DROP AS
SELECT MIN(t_from) AS t0, MAX(t_to) AS t1 FROM _seq;

CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT m.id, m.code, m."factoryId" FROM machines m
 WHERE m.code = ANY (string_to_array(:'machines', ','));

-- ── The sequence, resolved to one row per machine per band ──────────────────
-- `*` expands here and nowhere else, so every later step reads a table in
-- which every band already names its machine. Nothing downstream has to
-- remember that a wildcard exists.
CREATE TEMP TABLE _band ON COMMIT DROP AS
SELECT m.id AS machine_id, m.code, m."factoryId",
       q.seq, q.state, q.t_from, q.t_to, q.from_local, q.to_local
  FROM _seq q
  JOIN _m m ON q.machine = '*' OR q.machine = m.code;

\echo ''
\echo '0. THE SEQUENCE MUST BE CONTIGUOUS (want 0 rows)'
-- A gap would leave minutes classified by nothing; an overlap would let two
-- bands both claim a minute and the later write would silently win.
-- Per MACHINE, because a band may name one machine and its neighbour another;
-- checking the sequence alone would miss a machine that is skipped in a band.
SELECT a.code, a.seq AS ends_band, a.to_local AS ends_at,
       b.seq AS next_band, b.from_local AS starts_at,
       CASE WHEN b.t_from > a.t_to THEN 'GAP' ELSE 'OVERLAP' END AS fault
  FROM _band a JOIN _band b ON b.machine_id = a.machine_id AND b.seq = a.seq + 1
 WHERE b.t_from <> a.t_to
 UNION ALL
-- And every machine must appear in every band, or its timeline has a hole.
SELECT m.code, q.seq, q.from_local, NULL, NULL, 'MACHINE MISSING FROM BAND'
  FROM (SELECT DISTINCT seq, from_local FROM _seq) q CROSS JOIN _m m
 WHERE NOT EXISTS (SELECT 1 FROM _band b WHERE b.machine_id = m.id AND b.seq = q.seq);

\echo ''
\echo '1. THE WINDOW AS DECLARED'
SELECT seq, from_local AS riyadh_from, to_local AS riyadh_to,
       round((EXTRACT(EPOCH FROM (t_to - t_from)) / 60)::numeric, 0) AS minutes,
       string_agg(code || '=' || state::text, '  ' ORDER BY code) AS per_machine
  FROM _band GROUP BY seq, from_local, to_local, t_from, t_to ORDER BY seq;
SELECT (t0 + interval '3 hours') AS window_from, (t1 + interval '3 hours') AS window_to,
       (SELECT round(MAX(mins)::numeric, 0) FROM (
          SELECT SUM(EXTRACT(EPOCH FROM (t_to - t_from)) / 60) AS mins
            FROM _band WHERE state = 'RUNNING' GROUP BY machine_id) x) AS running_minutes
  FROM _span;
SELECT string_agg(code, ',' ORDER BY code) AS machines, count(*) AS n FROM _m;

-- ── Rates, in PIECES per minute ─────────────────────────────────────────────
-- `oee_minutes.goodParts` counts PIECES; a job order counts INNER, CARTON or
-- PALLET. `per_unit` is the ladder, and it is the only thing standing between
-- "7,245 inners" and "7,245 pallets".
CREATE TEMP TABLE _plan ON COMMIT DROP AS
SELECT m.id AS machine_id, m.code, j.id AS jo_id, j."outputUnit" AS unit,
       lad.per_unit,
       (60.0 / NULLIF(j."idealCycleTimeSec", 0)) * lad.per_unit AS design_ppm,
       COALESCE((
         SELECT AVG(o."goodParts") FROM oee_minutes o
          WHERE o."machineId" = m.id AND o."goodParts" > 0
            AND o."bucketStart" >= (SELECT t0 FROM _span) - interval '2 hours'
            AND o."bucketStart" <  (SELECT t0 FROM _span)
       ), 0)::float8 AS actual_ppm,
       -- Per machine: this table's first band gives each one a different
       -- state, so "how long did it run" is a per-machine question now.
       COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.t_to - b.t_from)) / 60)
                   FROM _band b WHERE b.machine_id = m.id AND b.state = 'RUNNING'), 0) AS run_minutes
  FROM _m m
  JOIN job_orders j ON j."machineId" = m.id AND j.status = 'EXECUTING'
  JOIN work_orders w ON w.id = j."workOrderId"
  LEFT JOIN skus s ON s.id = w."skuId"
  CROSS JOIN LATERAL (SELECT (CASE upper(COALESCE(j."outputUnit", ''))
      WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
      WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
      WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
      ELSE 1 END)::float8 AS per_unit) lad;

CREATE TEMP TABLE _rate ON COMMIT DROP AS
SELECT p.*,
       CASE WHEN lower(:'rate') = 'none'                        THEN 0
            WHEN lower(:'rate') = 'actual' AND p.actual_ppm > 0 THEN p.actual_ppm
            ELSE p.design_ppm END AS ppm
  FROM _plan p;

-- ── What the window holds RIGHT NOW ─────────────────────────────────────────
-- Captured before a single row is written. The cumulative counters move by the
-- DIFFERENCE between this and what the window holds afterwards, which is what
-- makes a second run a no-op instead of a second helping.
CREATE TEMP TABLE _before ON COMMIT DROP AS
SELECT r.jo_id, r.per_unit,
       COALESCE(SUM(o."goodParts"), 0) AS pieces_before
  FROM _rate r
  LEFT JOIN oee_minutes o ON o."jobOrderId" = r.jo_id
       AND o."bucketStart" >= (SELECT t0 FROM _span)
       AND o."bucketStart" <  (SELECT t1 FROM _span)
 GROUP BY r.jo_id, r.per_unit;

\echo ''
\echo '2. WHAT WILL BE WRITTEN, AND WHAT THE COUNTERS MOVE BY'
\echo '   moves_by = what the window will hold, minus what it holds now.'
\echo '   Run this twice and the second moves_by is zero.'
SELECT r.code, r.unit, round(r.per_unit::numeric, 0) AS pieces_per_unit,
       round(r.design_ppm::numeric, 2) AS design_ppm,
       round(r.actual_ppm::numeric, 2) AS actual_ppm,
       round((r.ppm * r.run_minutes)::numeric, 0) AS pieces_after,
       round(b.pieces_before::numeric, 0) AS pieces_now,
       round(((r.ppm * r.run_minutes - b.pieces_before) / r.per_unit)::numeric, 0) AS moves_by,
       j."actualQtyGood" AS job_order_now,
       j."actualQtyGood" + round(((r.ppm * r.run_minutes - b.pieces_before) / r.per_unit)::numeric, 0) AS job_order_after
  FROM _rate r JOIN _before b ON b.jo_id = r.jo_id JOIN job_orders j ON j.id = r.jo_id
 ORDER BY r.code;

\echo ''
\echo '3. WHAT IS IN THE WINDOW NOW, AND WILL BE REPLACED'
SELECT m.code, rec.state, count(*) AS records, round(SUM(rec."durationMinutes")::numeric, 0) AS minutes
  FROM machine_state_records rec JOIN _m m ON m.id = rec."machineId" CROSS JOIN _span s
 WHERE rec."startTime" < s.t1 AND COALESCE(rec."endTime", timestamp '9999-12-31') > s.t0
 GROUP BY m.code, rec.state ORDER BY m.code, rec.state;

\if :apply

  -- ── 1. Clear the window without disturbing what lies outside it ───────────
  -- Three steps, because a record can start before the window, end after it,
  -- or sit inside. Truncating the stragglers first means the delete only ever
  -- removes rows wholly inside, and no time outside changes meaning.
  UPDATE machine_state_records rec
     SET "endTime" = s.t0,
         "durationMinutes" = EXTRACT(EPOCH FROM (s.t0 - rec."startTime")) / 60,
         notes = concat_ws(' ', rec.notes, '[clipped: the window after this was restated]')
    FROM _span s
   WHERE rec."machineId" IN (SELECT id FROM _m)
     AND rec."startTime" < s.t0
     AND COALESCE(rec."endTime", timestamp '9999-12-31') > s.t0;

  UPDATE machine_state_records rec
     SET "startTime" = s.t1,
         "durationMinutes" = CASE WHEN rec."endTime" IS NULL THEN NULL
                                  ELSE EXTRACT(EPOCH FROM (rec."endTime" - s.t1)) / 60 END,
         notes = concat_ws(' ', rec.notes, '[clipped: the window before this was restated]')
    FROM _span s
   WHERE rec."machineId" IN (SELECT id FROM _m)
     AND rec."startTime" >= s.t0 AND rec."startTime" < s.t1
     AND COALESCE(rec."endTime", timestamp '9999-12-31') > s.t1;

  DELETE FROM machine_state_records rec
   USING _span s
   WHERE rec."machineId" IN (SELECT id FROM _m)
     AND rec."startTime" >= s.t0
     AND COALESCE(rec."endTime", timestamp '9999-12-31') <= s.t1;

  -- ── 2. The declared bands ─────────────────────────────────────────────────
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", state, "startTime", "endTime", "durationMinutes",
     "isPlannedStop", "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, q."factoryId", q.machine_id, q.state, q.t_from, q.t_to,
         EXTRACT(EPOCH FROM (q.t_to - q.t_from)) / 60, false, NULL,
         '[stated by the plant: ' || q.state::text || ' ' || q.from_local || '-' || q.to_local || ']',
         'MANUAL'
    FROM _band q;

  -- ── 3. Downtime events must not contradict the bands ──────────────────────
  -- Unplanned events inside the window go; ones straddling its start are
  -- clipped back to it. Planned stops are untouched -- they are the plan, and
  -- the plan is not a measurement to correct.
  DELETE FROM downtime_events d
   USING _span s
   WHERE d."machineId" IN (SELECT id FROM _m) AND NOT d."isPlanned"
     AND d."startTime" >= s.t0
     AND COALESCE(d."endTime", timestamp '9999-12-31') <= s.t1;

  UPDATE downtime_events d
     SET "endTime" = s.t0,
         "durationMinutes" = EXTRACT(EPOCH FROM (s.t0 - d."startTime")) / 60,
         reason = concat_ws(' ', d.reason, '[clipped: the window after this was restated]'),
         "updatedAt" = now()
    FROM _span s
   WHERE d."machineId" IN (SELECT id FROM _m) AND NOT d."isPlanned"
     AND d."startTime" < s.t0
     AND COALESCE(d."endTime", timestamp '9999-12-31') > s.t0;

  -- One event per declared stop band. STARVED is an EXTERNAL loss: the machine
  -- was fit to run and had nothing to run on, so it leaves the availability
  -- denominator rather than counting against the machine. That distinction is
  -- the whole difference between STARVED and BREAKDOWN.
  INSERT INTO downtime_events
    (id, "factoryId", "machineId", reason, category, "reasonCode",
     "startTime", "endTime", "durationMinutes", "affectsOEE", "isPlanned",
     acknowledged, "updatedAt")
  SELECT gen_random_uuid()::text, q."factoryId", q.machine_id,
         'Stated by the plant: ' || q.state::text,
         -- Category and code per state, taken from what the plant's own events
         -- already use rather than invented: the measured M1 BLOCKED event was
         -- PROCESS/BLOCKED, M2's BREAKDOWN was MECHANICAL/UNPLANNED_BREAKDOWN,
         -- M4's STARVED was MATERIAL/STARVED. A first draft here guessed
         -- `IDLE_NO_ORDER`, which is not in the enum at all and aborted the
         -- transaction -- the reason nothing may be typed from memory.
         (CASE q.state
            WHEN 'STARVED'   THEN 'MATERIAL'
            WHEN 'BREAKDOWN' THEN 'MECHANICAL'
            ELSE                  'PROCESS'
          END)::"DowntimeCategory",
         (CASE q.state
            WHEN 'STARVED'   THEN 'STARVED'
            WHEN 'BREAKDOWN' THEN 'UNPLANNED_BREAKDOWN'
            ELSE                  'BLOCKED'
          END)::"DowntimeReasonCode",
         q.t_from, q.t_to, EXTRACT(EPOCH FROM (q.t_to - q.t_from)) / 60,
         -- A BREAKDOWN is the machine's own fault and counts against its
         -- availability. STARVED and BLOCKED are the line failing to feed or
         -- drain it -- external, and they leave the denominator. Flattening
         -- all three to one flag is how a starved machine comes to look broken.
         (q.state = 'BREAKDOWN'), false, false, now()
    FROM _band q
   WHERE q.state IN ('STARVED', 'BLOCKED', 'BREAKDOWN');

  -- ── 4. The minutes ────────────────────────────────────────────────────────
  -- Every minute in the window takes its band's classification, so nothing is
  -- left holding the old story. Production is written ABSOLUTELY, not added,
  -- which is half of what makes a second run harmless.
  UPDATE oee_minutes o
     SET "machineState" = q.state::text,
         "operatingMin"        = CASE WHEN q.state = 'RUNNING' THEN o."totalMin" ELSE 0 END,
         "externalLossMin"     = CASE WHEN q.state = 'STARVED' THEN o."totalMin" ELSE 0 END,
         "availabilityLossMin" = CASE WHEN q.state IN ('BREAKDOWN', 'BLOCKED') THEN o."totalMin" ELSE 0 END,
         "unmeasuredMin" = 0,
         "plannedStopMin" = 0,
         "goodParts" = CASE WHEN q.state = 'RUNNING' AND :no_production = 0 THEN r.ppm
                            WHEN q.state = 'RUNNING' THEN o."goodParts" ELSE 0 END,
         "rejectedParts" = 0,
         "theoreticalParts" = CASE WHEN q.state = 'RUNNING' THEN r.design_ppm ELSE 0 END
    FROM _band q, _rate r
   WHERE o."jobOrderId" = r.jo_id
     AND q.machine_id = r.machine_id
     AND o."bucketStart" >= q.t_from AND o."bucketStart" < q.t_to;

  \if :no_production
    \echo ''
    \echo 'no_production=1 -- states rewritten, counts left alone.'
  \else

  -- ── 5. The cumulative counters, by DIFFERENCE ─────────────────────────────
  -- `_after` is measured from the rows just written rather than recomputed from
  -- the rate, so the counters follow what the minute store actually holds. If
  -- the two ever disagree, the minute store is the one on screen.
  CREATE TEMP TABLE _after ON COMMIT DROP AS
  SELECT r.jo_id, r.per_unit, COALESCE(SUM(o."goodParts"), 0) AS pieces_after
    FROM _rate r
    LEFT JOIN oee_minutes o ON o."jobOrderId" = r.jo_id
         AND o."bucketStart" >= (SELECT t0 FROM _span)
         AND o."bucketStart" <  (SELECT t1 FROM _span)
   GROUP BY r.jo_id, r.per_unit;

  CREATE TEMP TABLE _delta ON COMMIT DROP AS
  SELECT a.jo_id, r.machine_id,
         ROUND(((a.pieces_after - b.pieces_before) / a.per_unit)::numeric, 0) AS units
    FROM _after a JOIN _before b ON b.jo_id = a.jo_id JOIN _rate r ON r.jo_id = a.jo_id;

  -- Clamped at zero: a job order cannot hold a negative quantity, and a
  -- downward correction larger than the order's own total means something
  -- outside this window is wrong too.
  UPDATE job_orders j
     SET "actualQtyGood" = GREATEST(0, j."actualQtyGood" + d.units),
         notes = concat_ws(' ', j.notes,
           '[' || CASE WHEN d.units >= 0 THEN '+' ELSE '' END || d.units || ' '
                || COALESCE(j."outputUnit", 'unit') || ' restated for the '
                || :'day' || ' window at ' || lower(:'rate') || ' rate]')
    FROM _delta d
   WHERE j.id = d.jo_id AND d.units <> 0;

  UPDATE gateway_counter_states g
     SET accumulated = GREATEST(0, g.accumulated + d.units)
    FROM _delta d, tag_definitions t
   WHERE t.id = g."tagId" AND t."machineId" = d.machine_id
     AND t."counterRole" = 'GOOD' AND t."isActive" AND d.units <> 0;

  UPDATE machine_current_status s
     SET "goodCount" = GREATEST(0, s."goodCount" + d.units)::int
    FROM _delta d
   WHERE s."machineId" = d.machine_id AND d.units <> 0;

  \endif

  \echo ''
  \echo 'RESULT -- the window now reads'
  SELECT m.code, rec.state,
         to_char(rec."startTime" + interval '3 hours', 'HH24:MI:SS') AS riyadh_from,
         to_char(rec."endTime"   + interval '3 hours', 'HH24:MI:SS') AS riyadh_to,
         round(rec."durationMinutes"::numeric, 1) AS minutes
    FROM machine_state_records rec JOIN _m m ON m.id = rec."machineId" CROSS JOIN _span s
   WHERE rec."startTime" >= s.t0 AND rec."startTime" < s.t1
   ORDER BY m.code, rec."startTime";

  \echo ''
  \echo 'VERIFY -- the stores agree on the window'
  SELECT r.code, r.unit,
         round(SUM(o."goodParts")::numeric, 0) AS pieces_in_window,
         round((SUM(o."goodParts") / r.per_unit)::numeric, 1) AS units_in_window,
         j."actualQtyGood" AS job_order_total,
         g.accumulated AS edge_accumulated
    FROM _rate r
    JOIN oee_minutes o ON o."jobOrderId" = r.jo_id
    CROSS JOIN _span s
    JOIN job_orders j ON j.id = r.jo_id
    LEFT JOIN tag_definitions tg ON tg."machineId" = r.machine_id
         AND tg."counterRole" = 'GOOD' AND tg."isActive"
    LEFT JOIN gateway_counter_states g ON g."tagId" = tg.id
   WHERE o."bucketStart" >= s.t0 AND o."bucketStart" < s.t1
   GROUP BY r.code, r.unit, r.per_unit, j."actualQtyGood", g.accumulated
   ORDER BY r.code;

  \echo ''
  \echo 'VERIFY -- no state in the window that was not declared (want 0 rows)'
  SELECT DISTINCT rec.state FROM machine_state_records rec
    JOIN _m m ON m.id = rec."machineId" CROSS JOIN _span s
   WHERE rec."startTime" >= s.t0 AND rec."startTime" < s.t1
     AND rec.state NOT IN (SELECT state FROM _band);

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'Run it again and every moves_by should be 0.'
  \echo 'On a LIVE plant, restart the gateway so it re-seeds `accumulated`.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Check the sequence in section 1 and the machine list before applying.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
