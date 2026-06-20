-- Link a maintenance work order to MULTIPLE FMEA failure modes (was a single failureModeId column).
-- The legacy maintenance_wos."failureModeId" column is kept for backward compatibility and is
-- populated with the first selected mode; the join table below is the source of truth for the list.

-- CreateTable
CREATE TABLE IF NOT EXISTS "maintenance_wo_failure_modes" (
    "woId" TEXT NOT NULL,
    "failureModeId" TEXT NOT NULL,
    CONSTRAINT "maintenance_wo_failure_modes_pkey" PRIMARY KEY ("woId","failureModeId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "maintenance_wo_failure_modes_failureModeId_idx" ON "maintenance_wo_failure_modes"("failureModeId");

-- AddForeignKey
ALTER TABLE "maintenance_wo_failure_modes"
    ADD CONSTRAINT "maintenance_wo_failure_modes_woId_fkey"
    FOREIGN KEY ("woId") REFERENCES "maintenance_wos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_wo_failure_modes"
    ADD CONSTRAINT "maintenance_wo_failure_modes_failureModeId_fkey"
    FOREIGN KEY ("failureModeId") REFERENCES "failure_modes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing single-link work orders into the join table
INSERT INTO "maintenance_wo_failure_modes" ("woId", "failureModeId")
SELECT "id", "failureModeId" FROM "maintenance_wos"
WHERE "failureModeId" IS NOT NULL
ON CONFLICT DO NOTHING;
