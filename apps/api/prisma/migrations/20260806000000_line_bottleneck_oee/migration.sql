-- ============================================================
-- Bottleneck-based Overall Line OEE  (NCC PoC items 8 & 9)
-- ============================================================
-- NCC observed Big Betti and Cartomac showing a high OEE while the Palletizer and
-- Wrapping Machine showed an unrealistically low one, with no actual faults on
-- them: downstream assets wait on the constraint, so measuring the line by
-- averaging or rolling up every machine misrepresents it.
--
-- The agreed method is:
--   Overall Line OEE = Bottleneck Availability
--                    × Bottleneck Performance
--                    × Final Outfeed Quality
--
-- These two nullable columns nominate, per line, which machine is the constraint
-- and which is the final counting point. Both are optional — when NULL the API
-- falls back to the lowest-designCapacity machine and the highest-sortOrder
-- machine respectively, so existing lines keep working untouched.
--
-- Purely additive: no column is dropped, no existing row is rewritten. Safe to
-- apply to the live database.

ALTER TABLE "production_lines"
  ADD COLUMN "bottleneckMachineId" TEXT,
  ADD COLUMN "outfeedMachineId"    TEXT;

COMMENT ON COLUMN "production_lines"."bottleneckMachineId" IS
  'Constraint machine that sets the line rate; source of Availability and Performance for Overall Line OEE. NULL = auto (lowest designCapacity).';

COMMENT ON COLUMN "production_lines"."outfeedMachineId" IS
  'Final counting point on the line; source of Quality for Overall Line OEE. NULL = auto (highest sortOrder).';
