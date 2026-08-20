-- The same time model measured against the COMMITTED slot rather than the time
-- that went by. A third store beside oee_minutes and production_snapshots: the
-- three divide the same measured minutes by three different denominators, and
-- keeping them apart is what lets a disagreement between them be read as
-- information instead of as a bug.
CREATE TABLE "oee_schedule_minutes" (
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
    -- The committed slot, identical on every row of a job order so a read takes
    -- MIN/MAX per order and clips to the window without a second query.
    "committedFrom" TIMESTAMP(3) NOT NULL,
    "committedTo" TIMESTAMP(3) NOT NULL,
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
    CONSTRAINT "oee_schedule_minutes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oee_schedule_minutes_jobOrderId_bucketStart_key" ON "oee_schedule_minutes"("jobOrderId", "bucketStart");
CREATE INDEX "oee_schedule_minutes_machineId_bucketStart_idx" ON "oee_schedule_minutes"("machineId", "bucketStart");
CREATE INDEX "oee_schedule_minutes_factoryId_bucketStart_idx" ON "oee_schedule_minutes"("factoryId", "bucketStart");
CREATE INDEX "oee_schedule_minutes_shiftTemplateId_bucketStart_idx" ON "oee_schedule_minutes"("shiftTemplateId", "bucketStart");
CREATE INDEX "oee_schedule_minutes_workOrderId_idx" ON "oee_schedule_minutes"("workOrderId");

ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oee_schedule_minutes" ADD CONSTRAINT "oee_schedule_minutes_jobOrderId_fkey"
  FOREIGN KEY ("jobOrderId") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
