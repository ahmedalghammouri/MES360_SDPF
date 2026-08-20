-- The Insights Hub time model, one row per machine-minute.
--
-- A second fact store beside production_snapshots, on purpose: the two answer to
-- different references, and running them side by side is the only way to tell a
-- disagreement between engines from a disagreement with reality.
CREATE TABLE "oee_minutes" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "factoryId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "jobOrderId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "shiftTemplateId" TEXT,
    "shiftCode" TEXT,
    "machineState" TEXT,
    "jobOrderStatus" TEXT NOT NULL,
    -- The five buckets below are mutually exclusive and sum to totalMin.
    "totalMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedStopMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availabilityLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalLossMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmeasuredMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatingMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rejectedParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "theoreticalParts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "designSpeedPph" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oee_minutes_pkey" PRIMARY KEY ("id")
);

-- One row per job order per minute. The upsert key, and the guarantee that a
-- re-run of the writer corrects a minute instead of duplicating it.
CREATE UNIQUE INDEX "oee_minutes_jobOrderId_bucketStart_key" ON "oee_minutes"("jobOrderId", "bucketStart");
CREATE INDEX "oee_minutes_machineId_bucketStart_idx" ON "oee_minutes"("machineId", "bucketStart");
CREATE INDEX "oee_minutes_factoryId_bucketStart_idx" ON "oee_minutes"("factoryId", "bucketStart");
CREATE INDEX "oee_minutes_shiftTemplateId_bucketStart_idx" ON "oee_minutes"("shiftTemplateId", "bucketStart");
CREATE INDEX "oee_minutes_workOrderId_idx" ON "oee_minutes"("workOrderId");

ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oee_minutes" ADD CONSTRAINT "oee_minutes_jobOrderId_fkey"
  FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
