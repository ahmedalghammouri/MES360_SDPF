-- Separate operator-entered (manual) good/scrap from the gateway counter's auto counts,
-- so the counter never overwrites manual scrap. actualQty* stays the total (auto + manual).
ALTER TABLE "job_orders" ADD COLUMN IF NOT EXISTS "manualQtyGood" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "job_orders" ADD COLUMN IF NOT EXISTS "manualQtyRejected" DOUBLE PRECISION NOT NULL DEFAULT 0;
