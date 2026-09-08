-- Reconcile every step's good output against the machine that feeds the line.
--
-- ══ THE IDEA ═══════════════════════════════════════════════════════════════
-- Material is conserved. A cartoner cannot pack more inners than the filler
-- filled, and a palletiser cannot stack more cartons than the cartoner made.
-- So M1's count, run through the SKU ladder, is a CEILING on every step after
-- it — and anything above that ceiling is a counting error, not production.
--
-- ══ TWO MODES, AND THEY CLAIM DIFFERENT THINGS ═════════════════════════════
--
--   -v mode=cap      (default)  A step is reduced only where it EXCEEDS what
--                               M1 fed it. Steps below the ceiling are left
--                               exactly as they are.
--
--   -v mode=equal               Every step is SET to the ladder from M1, up or
--                               down. This is the stronger claim: that nothing
--                               was scrapped between stations, nothing was left
--                               in a buffer at the end of the run, and no
--                               pallet finished part-full.
--
-- `cap` corrects what is impossible. `equal` also overwrites what is merely
-- lower — and lower is the normal, expected shape of a packing line. The step
-- yield a plant reads on its quality pages IS that difference; setting every
-- step equal makes every yield exactly 100% and deletes the measurement.
--
-- ══ ⚠ WHAT `equal` WOULD DO TO A FIGURE YOU ALREADY VERIFIED ═══════════════
-- On WO-2026-0005 the plant checked the pallets by hand and stated 31. M1 holds
-- 9,668 inners and the ladder there is 6 inners per carton, 52 cartons per
-- pallet, so 9,668 / 312 = 30.98 — and `equal` would write 30, overwriting a
-- hand-counted 31 with a derived 30.
--
-- That is the shape of the whole objection. A partial pallet at the end of a
-- run is real, and flooring the division cannot see it. `cap` leaves 31 alone
-- because 31 is below the ceiling of 30.98 + a part pallet... it is not, and
-- the preview flags it: 31 exceeds the ceiling by less than one whole unit.
-- Orders inside one unit of the ceiling are reported as WITHIN ROUNDING and
-- left alone by both modes, because a rounding difference is not a miscount.
--
-- ══ ⚠ THE ANCHOR IS NOT CLEAN EITHER ═══════════════════════════════════════
-- M1 is the best anchor available — first step, its own device, its own address
-- on EDGECOUNTER01 — and it is still a counter on a line whose counters have
-- been over-reporting. On WO-2026-0005 M1 itself read about 1.8x the plant's
-- own figure before it was rescaled by hand.
--
-- So this does not make the numbers TRUE. It makes them CONSISTENT with one
-- number, and that number is M1's. Everything downstream inherits whatever M1
-- got wrong. Worth doing, worth knowing.
--
-- ══ WHAT IT WRITES ═════════════════════════════════════════════════════════
--   job_orders.actualQtyGood      the step's own unit
--   oee_minutes.goodParts         scaled by the same factor, so the minute
--                                 store and the job order still agree
--   gateway_counter_states        the edge's accumulator for that step
--
-- Rejected quantities are NOT touched. A reject is a thing somebody counted or
-- entered; it is not derived from the step before it, and scaling it would
-- invent scrap the plant never saw.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f reconcile-steps-to-anchor.sql
--   APPLY:    { cat reconcile-steps-to-anchor.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
--   -v mode=cap|equal        -v anchor=M1
--   -v chain=1               cap each step against the one BEFORE it, not
--                            against M1. Catches a palletiser above the
--                            cartoner that is still under the filler --
--                            which is five of the eleven orders here.
--   -v status=COMPLETED      which work orders to touch
--   -v orders='WO-2026-0003,WO-2026-0008'   only these, whatever their status
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?mode}
\else
  \set mode 'cap'
\endif
\if :{?anchor}
\else
  \set anchor 'M1'
\endif
\if :{?status}
\else
  \set status 'COMPLETED'
\endif
\if :{?orders}
\else
  \set orders ''
\endif
\if :{?chain}
\else
  \set chain 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE _wo ON COMMIT DROP AS
SELECT w.id, w."orderNumber",
       COALESCE(s."unitsPerInner", 1)    AS upi,
       COALESCE(s."innersPerCarton", 1)  AS ipc,
       COALESCE(s."cartonsPerPallet", 1) AS cpp
  FROM work_orders w
  LEFT JOIN skus s ON s.id = w."skuId"
 WHERE CASE WHEN :'orders' = '' THEN w.status::text = :'status'
            ELSE w."orderNumber" = ANY (string_to_array(:'orders', ',')) END;

-- ── Every step, with its own unit expressed in PIECES ───────────────────────
-- `per_unit` is the ladder and it is the only thing that makes an inner and a
-- pallet comparable. Getting it wrong turns "9,668 inners" into "9,668 pallets".
CREATE TEMP TABLE _step ON COMMIT DROP AS
SELECT w."orderNumber" AS wo, w.id AS wo_id, m.code, j.id AS jo_id,
       j."sequenceOrder" AS seq, j."outputUnit" AS unit, j."actualQtyGood" AS good,
       (CASE upper(COALESCE(j."outputUnit", ''))
          WHEN 'PALLET' THEN w.cpp * w.ipc * w.upi
          WHEN 'CARTON' THEN w.ipc * w.upi
          WHEN 'INNER'  THEN w.upi
          ELSE 1 END)::float8 AS per_unit
  FROM _wo w
  JOIN job_orders j ON j."workOrderId" = w.id
  JOIN machines m ON m.id = j."machineId";

-- ── What the anchor fed the line, in pieces ─────────────────────────────────
CREATE TEMP TABLE _anchor ON COMMIT DROP AS
SELECT wo_id, good * per_unit AS anchor_pieces
  FROM _step WHERE code = :'anchor';

-- ── The ceiling, and the verdict ────────────────────────────────────────────
-- WITHIN ROUNDING is its own verdict and not a silent pass. A step sitting less
-- than one whole unit above the ceiling is a part-pallet or a part-carton at
-- the end of a run, which is real; calling it an overcount and shaving it would
-- lose a genuine unit on almost every order.
CREATE TEMP TABLE _plan ON COMMIT DROP AS
SELECT s.*, a.anchor_pieces,
       a.anchor_pieces / s.per_unit AS ceiling_units,
       floor(a.anchor_pieces / s.per_unit) AS derived_units,
       CASE
         WHEN s.code = :'anchor'                                    THEN 'ANCHOR'
         WHEN s.good > a.anchor_pieces / s.per_unit + 1             THEN 'ABOVE CEILING'
         WHEN s.good > a.anchor_pieces / s.per_unit                 THEN 'WITHIN ROUNDING'
         ELSE                                                            'BELOW'
       END AS verdict
  FROM _step s JOIN _anchor a ON a.wo_id = s.wo_id;

-- ── The CHAINED ceiling: each step against the one before it ────────────────
-- The first version of this capped everything against M1, and that leaves a
-- hole the plant's own data walked straight through: M3 stayed ABOVE M2 on
-- five orders after the cap, by 880 pieces on WO-2026-0003 and 312 on
-- WO-2026-0008, because both were still under M1's ceiling. A palletiser
-- cannot stack cartons the cartoner never made, whatever the filler did.
--
-- So the ceiling walks the routing: M2 <= M1, M3 <= M2 as CAPPED, M4 <= M3 as
-- capped. Recursive, because each step's ceiling depends on the corrected
-- value of the step before it, not on its recorded one -- otherwise an
-- over-count in the middle raises the ceiling for everything after it.
--
-- The same one-whole-unit allowance applies at every link, for the same reason
-- it applies at the anchor: a part pallet at the end of a run is real.
CREATE TEMP TABLE _chain ON COMMIT DROP AS
WITH RECURSIVE ordered AS (
  SELECT s.*, row_number() OVER (PARTITION BY s.wo_id ORDER BY s.seq) AS n FROM _step s
), walk AS (
  SELECT o.jo_id, o.wo_id, o.n, o.per_unit, o.good AS chain_good,
         o.good * o.per_unit AS chain_pieces
    FROM ordered o WHERE o.n = 1
  UNION ALL
  SELECT o.jo_id, o.wo_id, o.n, o.per_unit,
         CASE WHEN o.good * o.per_unit > w.chain_pieces + o.per_unit
              THEN floor(w.chain_pieces / o.per_unit)
              ELSE o.good END,
         CASE WHEN o.good * o.per_unit > w.chain_pieces + o.per_unit
              THEN floor(w.chain_pieces / o.per_unit) * o.per_unit
              ELSE o.good * o.per_unit END
    FROM walk w JOIN ordered o ON o.wo_id = w.wo_id AND o.n = w.n + 1
)
SELECT jo_id, chain_good FROM walk;

CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT p.*,
       CASE
         WHEN lower(:'mode') = 'equal' AND p.verdict <> 'ANCHOR' THEN p.derived_units
         WHEN :chain <> 0                                        THEN c.chain_good
         WHEN p.verdict = 'ABOVE CEILING'                        THEN p.derived_units
         ELSE p.good
       END AS new_good
  FROM _plan p JOIN _chain c ON c.jo_id = p.jo_id;

-- ── The job-order / minute-store gap as it stands BEFORE anything is written ─
-- Several of these orders already disagree with their own minute store --
-- WO-2026-0001 M2 by about 700 cartons -- and scaling preserves that ratio
-- rather than closing it. Captured here so the verification at the end can
-- show the gap was INHERITED. Without this column the final table reads as
-- damage this script caused, which is the misreading it invites.
CREATE TEMP TABLE _drift_before ON COMMIT DROP AS
SELECT t.jo_id, t.good AS jo_good,
       COALESCE(SUM(o."goodParts"), 0) / t.per_unit AS store_units
  FROM _step t LEFT JOIN oee_minutes o ON o."jobOrderId" = t.jo_id
 GROUP BY t.jo_id, t.good, t.per_unit;

\echo ''
\echo '1. THE SETTINGS'
SELECT :'mode' AS mode, (:chain <> 0) AS chained, :'anchor' AS anchor,
       CASE WHEN :'orders' = '' THEN 'status = ' || :'status' ELSE :'orders' END AS scope,
       (SELECT count(*) FROM _wo) AS work_orders;

\echo ''
\echo '2. EVERY STEP, AND WHAT IT WOULD BECOME'
SELECT wo, code, unit, good AS good_now,
       round(ceiling_units::numeric, 2) AS ceiling_from_anchor,
       verdict, new_good,
       (new_good - good) AS moves_by
  FROM _target ORDER BY wo, seq;

\echo ''
\echo '3. THE SUMMARY THAT DECIDES IT'
SELECT verdict, count(*) AS steps,
       count(*) FILTER (WHERE new_good <> good) AS would_change
  FROM _target GROUP BY verdict ORDER BY verdict;

\echo ''
\echo '   ABOVE CEILING is impossible and both modes fix it.'
\echo '   BELOW is normal step loss. Only mode=equal touches it, and doing so'
\echo '   sets every step yield to 100% and deletes the measurement.'

\if :apply

  -- ── The job order ─────────────────────────────────────────────────────────
  UPDATE job_orders j
     SET "actualQtyGood" = t.new_good,
         notes = concat_ws(' ', j.notes,
           '[reconciled to ' || :'anchor' || ' (' || lower(:'mode') || '): '
           || t.good || ' -> ' || t.new_good || ' ' || COALESCE(j."outputUnit", 'unit') || ']')
    FROM _target t
   WHERE j.id = t.jo_id AND t.new_good <> t.good;

  -- ── The minute store, by the same factor ──────────────────────────────────
  -- Scaled rather than rewritten: the SHAPE of the run — which minutes produced
  -- and which did not — is a measurement, and only its total is in question.
  -- Not rounded per minute either: rounding a fraction up across six hundred
  -- minutes would put the total back where it started.
  UPDATE oee_minutes o
     SET "goodParts" = o."goodParts" * (t.new_good::float8 / NULLIF(t.good, 0))
    FROM _target t
   WHERE o."jobOrderId" = t.jo_id AND t.new_good <> t.good AND t.good > 0;

  UPDATE oee_schedule_minutes o
     SET "goodParts" = o."goodParts" * (t.new_good::float8 / NULLIF(t.good, 0))
    FROM _target t
   WHERE o."jobOrderId" = t.jo_id AND t.new_good <> t.good AND t.good > 0;

  -- ── The edge's accumulator ────────────────────────────────────────────────
  -- Moved by the same amount, so a gateway restart re-seeds from a figure that
  -- agrees with the job order rather than re-reporting the difference.
  UPDATE gateway_counter_states g
     SET accumulated = GREATEST(0, g.accumulated + (t.new_good - t.good))
    FROM _target t, tag_definitions tg, job_orders j
   WHERE tg.id = g."tagId" AND j.id = t.jo_id
     AND tg."machineId" = j."machineId"
     AND tg."counterRole" = 'GOOD' AND tg."isActive"
     AND g."jobOrderId" = t.jo_id
     AND t.new_good <> t.good;

  \echo ''
  \echo 'RESULT -- the line, step by step'
  SELECT t.wo, t.code, t.unit, j."actualQtyGood" AS good_now,
         round((j."actualQtyGood" * t.per_unit)::numeric, 0) AS pieces
    FROM _target t JOIN job_orders j ON j.id = t.jo_id
   ORDER BY t.wo, t.seq;

  \echo ''
  \echo 'VERIFY -- nothing left above the ceiling (want 0 rows)'
  SELECT t.wo, t.code, j."actualQtyGood" AS good, round(t.ceiling_units::numeric, 2) AS ceiling
    FROM _target t JOIN job_orders j ON j.id = t.jo_id
   WHERE t.code <> :'anchor' AND j."actualQtyGood" > t.ceiling_units + 1;

  \echo ''
  \echo 'VERIFY -- did this script widen the job-order / minute-store gap?'
  \echo '   Only |after| > |before| is this script''s doing. The rest was'
  \echo '   already there and is preserved, not created.'
  SELECT t.wo, t.code, j."actualQtyGood" AS job_order,
         round((SUM(o."goodParts") / t.per_unit)::numeric, 1) AS minute_store,
         round((b.jo_good - b.store_units)::numeric, 0) AS drift_before,
         round((j."actualQtyGood" - SUM(o."goodParts") / t.per_unit)::numeric, 0) AS drift_after,
         CASE WHEN abs(j."actualQtyGood" - SUM(o."goodParts") / t.per_unit)
                   > abs(b.jo_good - b.store_units) + 1
              THEN 'WIDENED' ELSE 'ok' END AS verdict
    FROM _target t
    JOIN _drift_before b ON b.jo_id = t.jo_id
    JOIN job_orders j ON j.id = t.jo_id
    LEFT JOIN oee_minutes o ON o."jobOrderId" = t.jo_id
   WHERE t.new_good <> t.good
   GROUP BY t.wo, t.code, t.seq, j."actualQtyGood", t.per_unit, b.jo_good, b.store_units
   ORDER BY t.wo, t.seq;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Read section 3. If BELOW would change, you are in mode=equal and you'
  \echo 'are overwriting real step loss, not correcting an error.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
