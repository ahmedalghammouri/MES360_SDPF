-- Enable incremental, per-step material consumption: each consumption row records
-- which job order (routing step) consumed the material, so completing a step
-- depletes its materials immediately and the WO-completion pass never double-counts.
ALTER TABLE "material_consumptions" ADD COLUMN IF NOT EXISTS "jobOrderId" TEXT;
CREATE INDEX IF NOT EXISTS "material_consumptions_jobOrderId_idx" ON "material_consumptions"("jobOrderId");
ALTER TABLE "material_consumptions" DROP CONSTRAINT IF EXISTS "material_consumptions_jobOrderId_fkey";
ALTER TABLE "material_consumptions" ADD CONSTRAINT "material_consumptions_jobOrderId_fkey"
  FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
