-- Bypass a routing step whose machine has gone out of service.
--
-- Nullable with no default, so every existing job order keeps counting exactly
-- as it did. Nothing is backfilled and no recorded minute is rewritten: the
-- MINUTE_FACTS view joins job_orders, so the flag reaches historical minutes by
-- being read, not by being copied.
ALTER TABLE "job_orders"
  ADD COLUMN IF NOT EXISTS "bypassedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bypassedBy"   TEXT,
  ADD COLUMN IF NOT EXISTS "bypassReason" TEXT;

-- Every read of the final-step rule filters on this, per work order.
CREATE INDEX IF NOT EXISTS "job_orders_bypass_idx"
  ON "job_orders" ("workOrderId", "bypassedAt");
