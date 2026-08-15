-- ============================================================
-- Line OEE calculation method + multi-machine final outfeed
-- ============================================================
-- Two changes, both driven by review feedback on the bottleneck work:
--
-- 1. The bottleneck method must be OPTIONAL. The historic quantity-weighted
--    roll-up is not wrong — it answers "how did the assets perform", while the
--    bottleneck method answers "how did the LINE perform". Forcing one on every
--    line would replace one misleading default with another, so the basis is now
--    an explicit per-line choice that defaults to the existing behaviour.
--
-- 2. A line can finish through MORE THAN ONE outfeed (e.g. parallel palletizers),
--    so the single outfeedMachineId cannot express reality. It becomes a list,
--    where an empty list means "every machine on the line counts as outfeed".
--
-- Runs after 20260806000000_line_bottleneck_oee, so "outfeedMachineId" exists.
-- Any value already set is carried into the new array before the column is
-- dropped — no configuration is lost.

-- ── 1. Calculation method ────────────────────────────────────────────
CREATE TYPE "OeeMethod" AS ENUM ('ROLLUP', 'BOTTLENECK');

ALTER TABLE "production_lines"
  ADD COLUMN "oeeMethod" "OeeMethod" NOT NULL DEFAULT 'ROLLUP';

COMMENT ON COLUMN "production_lines"."oeeMethod" IS
  'ROLLUP = quantity-weighted aggregation of every machine (historic default). BOTTLENECK = bottleneck A x bottleneck P x final-outfeed Q.';

-- ── 2. Multi-machine final outfeed ───────────────────────────────────
ALTER TABLE "production_lines"
  ADD COLUMN "outfeedMachineIds" TEXT[] NOT NULL DEFAULT '{}';

-- Carry across anything already configured as the single outfeed point.
UPDATE "production_lines"
   SET "outfeedMachineIds" = ARRAY["outfeedMachineId"]
 WHERE "outfeedMachineId" IS NOT NULL;

ALTER TABLE "production_lines"
  DROP COLUMN "outfeedMachineId";

COMMENT ON COLUMN "production_lines"."outfeedMachineIds" IS
  'Counting points where saleable units leave the line. Empty = every machine on the line is treated as an outfeed.';

-- A line set to BOTTLENECK without a nominated constraint still works — the API
-- falls back to the slowest routing cycle time and reports which rule it used —
-- so no backfill or NOT NULL constraint is needed here.
