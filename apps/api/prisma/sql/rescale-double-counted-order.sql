-- Bring an over-counted work order back to what the line actually made.
--
-- ══ WHAT THIS IS FOR ═══════════════════════════════════════════════════════
-- WO-2026-0005 recorded 58 pallets against a plan of 29 and a real output of
-- 31. Every step is inflated by roughly the same factor:
--
--   M1  Filling      9,008 planned   17,486 recorded   x1.94
--   M2  Cartoning    1,502 planned    2,889 recorded   x1.92
--   M3  Palletising     29 planned       58 recorded   x2.00
--   M4  Wrapping        29 planned       58 recorded   x2.00
--
-- ══ WHY PROPORTIONAL SCALING IS RIGHT HERE, AND WAS WRONG BEFORE ═══════════
-- `match-minutes-to-shopfloor.sql` deliberately does NOT scale: there the
-- surplus sat in three specific minutes -- a held backlog flushed as one delta
-- -- and shaving every honest minute to pay for one impossible one would have
-- corrupted the shift's shape to hide its cause.
--
-- This is the opposite shape, and the measurement says so. M1 counted across
-- 597 minutes with a largest minute of 52 against a ceiling of 50; only two
-- minutes exceed it at all. The inflation is spread evenly over every minute,
-- because contact ring adds a false count beside a true one -- so a uniform
-- ratio is not an approximation here, it is the model.
--
-- Check that before running this on a different order. If the surplus is
-- concentrated in a few impossible minutes, use the other script.
--
-- ══ ONE NUMBER FROM THE PLANT ══════════════════════════════════════════════
-- The true output of the FINAL step, in that step's own unit. Everything else
-- is derived through the SKU's packaging ladder, because these are serial steps
-- on one batch: 31 pallets IS 1,612 cartons IS 9,672 inners. Asking for four
-- numbers would invite four inconsistent ones.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -v wo=WO-2026-0005 -v true_final=31 < rescale-double-counted-order.sql
--   APPLY:    { cat rescale-double-counted-order.sql; echo "COMMIT;"; } \
--               | psql ... -v wo=WO-2026-0005 -v true_final=31 -v apply=1
--
-- ⚠ THIS DOES NOT FIX THE CAUSE. The debounce gate is off -- `gateway-config
-- .json` has no `machineLimits` at all -- so every contact bounce is still
-- being counted as a product. Repairing the figures without setting that gate
-- means doing this again after the next order.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?wo}
\else
  \set wo 'WO-2026-0005'
\endif
\if :{?true_final}
\else
  \echo 'ERROR: pass the true output of the final step, e.g.  -v true_final=31'
  \quit 1
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The true figure for every step, from one number ─────────────────────────
CREATE TEMP TABLE _scale ON COMMIT DROP AS
WITH steps AS (
  SELECT j.id AS jo_id, m.code AS machine, j."sequenceOrder" AS seq,
         j."operationName" AS op, j."outputUnit" AS unit,
         j."actualQtyGood" AS good, j."actualQtyRejected" AS rej,
         -- Pieces per one unit of this step's own output unit.
         (CASE upper(COALESCE(j."outputUnit", ''))
            WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
            WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
            WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
            ELSE 1
          END)::float8 AS per_unit
  FROM job_orders j
  JOIN machines m ON m.id = j."machineId"
  JOIN work_orders w ON w.id = j."workOrderId"
  LEFT JOIN skus s ON s.id = w."skuId"
  WHERE w."orderNumber" = :'wo'
),
final AS (SELECT * FROM steps ORDER BY seq DESC LIMIT 1)
SELECT st.*,
       -- The truth in pieces, stated once by the plant on the final step.
       (SELECT :true_final * f.per_unit FROM final f) AS true_pieces,
       -- ...and converted into THIS step's unit.
       (SELECT :true_final * f.per_unit FROM final f) / st.per_unit AS true_qty
FROM steps st;

CREATE TEMP TABLE _ratio ON COMMIT DROP AS
SELECT *,
       CASE WHEN good > 0 THEN true_qty / good ELSE 1 END AS factor
FROM _scale;

\echo ''
\echo 'WHAT THE PLANT SAYS IT MADE, STEP BY STEP'
SELECT machine, op, unit,
       round(good::numeric, 0)      AS recorded,
       round(true_qty::numeric, 0)  AS true_qty,
       round(factor::numeric, 3)    AS multiply_by,
       round((good - true_qty)::numeric, 0) AS removed
FROM _ratio ORDER BY seq;

\echo ''
\echo 'IS THE SURPLUS SPREAD, OR IN A FEW IMPOSSIBLE MINUTES?'
\echo 'Spread -> scaling is right. Concentrated -> use match-minutes-to-shopfloor.sql.'
SELECT m.code,
       count(*) FILTER (WHERE o."goodParts" > 0) AS counting_minutes,
       round(MAX(o."goodParts")::numeric, 0)     AS biggest_minute,
       round((MAX(o."designSpeedPph") / 60)::numeric, 0) AS ceiling_per_min,
       count(*) FILTER (WHERE o."designSpeedPph" > 0 AND o."goodParts" > o."designSpeedPph" / 60) AS over_ceiling
FROM oee_minutes o
JOIN machines m ON m.id = o."machineId"
JOIN _ratio r ON r.jo_id = o."jobOrderId"
GROUP BY 1 ORDER BY 1;

\if :apply

  -- ── The job order totals ──────────────────────────────────────────────────
  -- Rounded, because a job order cannot hold 30.6 pallets. Rejects take the
  -- same factor: contact ring does not distinguish good from bad, it simply
  -- counts a transition twice.
  UPDATE job_orders j
     SET "actualQtyGood"     = ROUND((j."actualQtyGood" * r.factor)::numeric, 0),
         "actualQtyRejected" = ROUND((j."actualQtyRejected" * r.factor)::numeric, 0),
         notes = concat_ws(' ', j.notes,
           '[rescaled x' || round(r.factor::numeric, 3) || ' - counted without a debounce gate]')
    FROM _ratio r
   WHERE j.id = r.jo_id AND r.factor <> 1;

  -- ── The minute store, by the same factor ──────────────────────────────────
  -- Not rounded per minute: rounding 0.6 of a piece to 1 across six hundred
  -- minutes would put the total back where it started. The minutes carry
  -- fractions and only their SUM has to match, which is what every reader of
  -- this table actually uses.
  UPDATE oee_minutes o
     SET "goodParts"     = o."goodParts" * r.factor,
         "rejectedParts" = o."rejectedParts" * r.factor
    FROM _ratio r
   WHERE o."jobOrderId" = r.jo_id AND r.factor <> 1;

  UPDATE oee_schedule_minutes o
     SET "goodParts"     = o."goodParts" * r.factor,
         "rejectedParts" = o."rejectedParts" * r.factor
    FROM _ratio r
   WHERE o."jobOrderId" = r.jo_id AND r.factor <> 1;

  -- ── The gateway's own accumulators ────────────────────────────────────────
  -- Otherwise the edge believes it has already reported more than the job
  -- order now holds, and books nothing until real production climbs past the
  -- old inflated figure -- the same debt `match-minutes-to-shopfloor.sql`
  -- exists to clear. Scaled by the machine's own factor.
  UPDATE gateway_counter_states g
     SET accumulated = ROUND((g.accumulated * r.factor)::numeric, 0)
    FROM _ratio r, tag_definitions t
   WHERE t.id = g."tagId"
     AND g."jobOrderId" = r.jo_id
     AND r.factor <> 1;

  \echo ''
  \echo 'RESULT -- job orders'
  SELECT m.code, j."operationName", j."outputUnit" AS unit, j."actualQtyGood" AS good
    FROM job_orders j JOIN machines m ON m.id = j."machineId"
   WHERE j.id IN (SELECT jo_id FROM _ratio) ORDER BY j."sequenceOrder";

  \echo ''
  \echo 'RESULT -- the minute store must agree with the job order'
  SELECT r.machine, round(r.true_qty::numeric, 0) AS should_be,
         round((SUM(o."goodParts") / r.per_unit)::numeric, 1) AS minute_store
    FROM oee_minutes o JOIN _ratio r ON r.jo_id = o."jobOrderId"
   GROUP BY r.machine, r.true_qty, r.per_unit, r.seq ORDER BY r.seq;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'AND SET THE DEBOUNCE, or the next order arrives inflated too.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Apply with  -v apply=1  and an appended COMMIT;'
\endif
