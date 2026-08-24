-- Materialising the schedule into state history becomes a choice, and the
-- choice defaults to NO.
--
-- The materialiser turns planned-stop TEMPLATES into machine_state_records so
-- the timeline and the OEE maths stop disagreeing inside a scheduled window.
-- That is right for a plant whose breaks repeat on a rule, and wrong for one
-- that plans day by day — there, a template writes windows nobody scheduled,
-- and the rows outlive the template that made them.
--
-- Default false so switching it on is a decision somebody made, rather than a
-- behaviour a plant discovers on its timeline.
ALTER TABLE "factories"
  ADD COLUMN IF NOT EXISTS "plannedStopMaterialisation" BOOLEAN NOT NULL DEFAULT false;
