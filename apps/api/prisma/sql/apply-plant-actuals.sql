-- Set a work order's output to the figure the production team actually counted.
--
-- ══ THE SOURCE ═════════════════════════════════════════════════════════════
-- The SDPF production team's daily sheet for 29 Aug – 6 Sep 2026, which reports
-- CARTONS at the cartoner. Four of its eleven producing SKU-days have a work
-- order in MES; those four are declared below. The other seven ran with no work
-- order open at all and cannot be repaired here — there is nothing to write to.
--
--   WO-2026-0006   GENTO LF Original 2.25    system 2,481  ->  plant 2,578
--   WO-2026-0007   GENTO LF Oud 2.25         system 1,028  ->  plant 1,058
--   WO-2026-0008   GENTO LF Flower 2.25      system 4,762  ->  plant 2,584
--   WO-2026-0011   GENTO HF Flower 2.25      system 2,013  ->  plant 2,400
--
-- WO-2026-0008 is the one that moves down hard: the sheet records 920 cartons on
-- 1 Sep and 1,664 on 2 Sep for that SKU, 2,584 together, against 4,762 in the
-- system. Roughly double, which is the shape this line has been producing since
-- the counters were first questioned.
--
-- ══ THE STATED UNIT IS CARTONS, AND THAT MATTERS ═══════════════════════════
-- The sheet counts cartons, so the declaration is in cartons and the anchor is
-- the CARTONER, not the filler. Every other step is derived from it through the
-- SKU ladder: 4 inners to a carton, 40 cartons to a pallet on these products.
-- Stating it in cartons and anchoring on M1 would have meant converting by hand
-- before typing, which is exactly where a factor of four goes missing.
--
-- ══ ⚠ THE PALLET STEPS BECOME EQUAL, AND THE SHEET CANNOT SAY OTHERWISE ════
-- M3 and M4 are both derived as floor(cartons / 40), so they come out identical.
-- The gap between them that the system currently shows — M4 reading 25-30% under
-- M3 on most orders — is erased here, not resolved. The sheet reports cartons
-- and says nothing about pallets, so there is no measurement to preserve it
-- with. If that gap is real it will reappear on the next order; if it is the
-- shared address-2 signal, it was never real. That question is still open.
--
-- ══ RE-RUNNING IS SAFE ═════════════════════════════════════════════════════
-- Written by DIFFERENCE, like every correction script here: what the order holds
-- now is measured, the target is computed, and the cumulative counters move by
-- the difference. Run it twice and the second pass moves nothing. Correct a
-- number in the table and only that correction moves.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f apply-plant-actuals.sql
--   APPLY:    { cat apply-plant-actuals.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
-- The step the figures are counted at. The sheet counts cartons: M2.
\if :{?anchor}
\else
  \set anchor 'M2'
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── THE PLANT'S FIGURES — EDIT HERE AND NOWHERE ELSE ────────────────────────
-- Work order, and what the production team counted at the anchor step.
CREATE TEMP TABLE _stated ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('WO-2026-0006', 2578),
  ('WO-2026-0007', 1058),
  ('WO-2026-0008', 2584),
  ('WO-2026-0011', 2400)
) AS v(order_number, stated_qty);

\echo ''
\echo '0. EVERY DECLARED ORDER MUST EXIST, AND MUST HAVE THE ANCHOR STEP (want 0 rows)'
-- A typo in an order number would otherwise pass silently as "nothing matched",
-- and a silent no-op on a correction script is worse than an error.
SELECT s.order_number,
       CASE WHEN w.id IS NULL THEN 'no such work order'
            ELSE 'no ' || :'anchor' || ' step on it' END AS fault
  FROM _stated s
  LEFT JOIN work_orders w ON w."orderNumber" = s.order_number
  LEFT JOIN job_orders j ON j."workOrderId" = w.id
  LEFT JOIN machines m ON m.id = j."machineId" AND m.code = :'anchor'
 GROUP BY s.order_number, w.id
HAVING w.id IS NULL OR count(m.id) = 0;

-- ── Every step of every declared order, in PIECES ───────────────────────────
-- `per_unit` is the SKU ladder. It is the only thing standing between
-- "2,578 cartons" and "2,578 pallets".
CREATE TEMP TABLE _step ON COMMIT DROP AS
SELECT s.order_number AS wo, w.id AS wo_id, m.code, j.id AS jo_id,
       j."sequenceOrder" AS seq, j."outputUnit" AS unit, j."actualQtyGood" AS good,
       s.stated_qty,
       (CASE upper(COALESCE(j."outputUnit", ''))
          WHEN 'PALLET' THEN COALESCE(k."cartonsPerPallet",1) * COALESCE(k."innersPerCarton",1) * COALESCE(k."unitsPerInner",1)
          WHEN 'CARTON' THEN COALESCE(k."innersPerCarton",1) * COALESCE(k."unitsPerInner",1)
          WHEN 'INNER'  THEN COALESCE(k."unitsPerInner",1)
          ELSE 1 END)::float8 AS per_unit
  FROM _stated s
  JOIN work_orders w ON w."orderNumber" = s.order_number
  JOIN job_orders j ON j."workOrderId" = w.id
  JOIN machines m ON m.id = j."machineId"
  LEFT JOIN skus k ON k.id = w."skuId";

-- The whole line's true output, in pieces, from the anchor step's stated figure.
CREATE TEMP TABLE _truth ON COMMIT DROP AS
SELECT wo_id, stated_qty * per_unit AS true_pieces
  FROM _step WHERE code = :'anchor';

CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT s.*, t.true_pieces,
       -- The anchor keeps the stated number exactly. Every other step is the
       -- same quantity of product expressed in its own unit, floored: a part
       -- pallet is not a pallet.
       CASE WHEN s.code = :'anchor' THEN s.stated_qty::float8
            ELSE floor(t.true_pieces / s.per_unit) END AS new_good
  FROM _step s JOIN _truth t ON t.wo_id = s.wo_id;

-- What the orders hold before anything is written, so the cumulative counters
-- can move by the difference and a second run can move nothing.
CREATE TEMP TABLE _before ON COMMIT DROP AS
SELECT jo_id, good AS good_before FROM _step;

\echo ''
\echo '1. WHAT CHANGES'
SELECT t.wo, t.code, t.unit,
       t.good AS system_now,
       t.new_good AS plant_actual,
       (t.new_good - t.good) AS moves_by,
       round((t.new_good * t.per_unit)::numeric, 0) AS pieces,
       CASE WHEN t.code = :'anchor' THEN 'stated' ELSE 'derived' END AS source
  FROM _target t ORDER BY t.wo, t.seq;

\echo ''
\echo '2. THE LINE TOTAL AT THE ANCHOR STEP'
SELECT t.wo, t.stated_qty AS plant_cartons, t.good AS system_cartons,
       (t.stated_qty - t.good) AS difference,
       round((100.0 * (t.stated_qty - t.good) / NULLIF(t.good, 0))::numeric, 1) AS pct
  FROM _target t WHERE t.code = :'anchor' ORDER BY t.wo;

\if :apply

  UPDATE job_orders j
     SET "actualQtyGood" = t.new_good,
         notes = concat_ws(' ', j.notes,
           '[set to the plant''s counted output: ' || t.good || ' -> ' || t.new_good
           || ' ' || COALESCE(j."outputUnit", 'unit') || ']')
    FROM _target t
   WHERE j.id = t.jo_id AND t.new_good <> t.good;

  -- The minute store is SCALED, not rewritten. Which minutes produced and which
  -- did not is a measurement of the run's shape; only the total was in question.
  -- Fractions are kept per minute: rounding each one up across six hundred
  -- minutes would put the total back where it started.
  UPDATE oee_minutes o
     SET "goodParts" = o."goodParts" * (t.new_good / NULLIF(t.good, 0))
    FROM _target t
   WHERE o."jobOrderId" = t.jo_id AND t.new_good <> t.good AND t.good > 0;

  UPDATE oee_schedule_minutes o
     SET "goodParts" = o."goodParts" * (t.new_good / NULLIF(t.good, 0))
    FROM _target t
   WHERE o."jobOrderId" = t.jo_id AND t.new_good <> t.good AND t.good > 0;

  -- The edge's accumulator, moved by the same amount so a gateway restart
  -- re-seeds from a figure that agrees with the job order.
  UPDATE gateway_counter_states g
     SET accumulated = GREATEST(0, g.accumulated + (t.new_good - t.good)::int)
    FROM _target t, tag_definitions tg, job_orders j
   WHERE tg.id = g."tagId" AND j.id = t.jo_id
     AND tg."machineId" = j."machineId"
     AND tg."counterRole" = 'GOOD' AND tg."isActive"
     AND g."jobOrderId" = t.jo_id
     AND t.new_good <> t.good;

  \echo ''
  \echo 'RESULT -- the line as it now reads'
  SELECT t.wo, t.code, t.unit, j."actualQtyGood" AS good,
         round((j."actualQtyGood" * t.per_unit)::numeric, 0) AS pieces
    FROM _target t JOIN job_orders j ON j.id = t.jo_id
   ORDER BY t.wo, t.seq;

  \echo ''
  \echo 'VERIFY -- the anchor step matches the sheet exactly (want 0 rows)'
  SELECT t.wo, j."actualQtyGood" AS system, t.stated_qty AS sheet
    FROM _target t JOIN job_orders j ON j.id = t.jo_id
   WHERE t.code = :'anchor' AND j."actualQtyGood" <> t.stated_qty;

  \echo ''
  \echo 'VERIFY -- did this widen the job-order / minute-store gap?'
  \echo '   Only |after| > |before| is this script''s doing.'
  SELECT t.wo, t.code, j."actualQtyGood" AS job_order,
         round((SUM(o."goodParts") / t.per_unit)::numeric, 1) AS minute_store,
         round((b.good_before - COALESCE(bs.pieces_before, 0) / t.per_unit)::numeric, 0) AS drift_before,
         round((j."actualQtyGood" - SUM(o."goodParts") / t.per_unit)::numeric, 0) AS drift_after
    FROM _target t
    JOIN _before b ON b.jo_id = t.jo_id
    JOIN job_orders j ON j.id = t.jo_id
    LEFT JOIN LATERAL (SELECT SUM(o2."goodParts") / NULLIF(t.new_good / NULLIF(t.good, 0), 0) AS pieces_before
                         FROM oee_minutes o2 WHERE o2."jobOrderId" = t.jo_id) bs ON true
    LEFT JOIN oee_minutes o ON o."jobOrderId" = t.jo_id
   WHERE t.new_good <> t.good
   GROUP BY t.wo, t.code, t.seq, j."actualQtyGood", t.per_unit, b.good_before, bs.pieces_before
   ORDER BY t.wo, t.seq;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'Run it again and every moves_by should be 0.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Check section 2 against the production team''s sheet before applying.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
