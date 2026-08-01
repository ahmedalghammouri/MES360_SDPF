-- ============================================================
-- Energy ratio per Work Order × Machine  +  fractional cycle times
-- ============================================================
-- Both changes are additive/widening. Nothing is dropped and no existing row is
-- rewritten, so this is safe to apply to the live database.

-- ── 1. MachineCycleTime.cycleTimeSeconds : INTEGER → DOUBLE PRECISION ──
-- Machines faster than one unit per second (Big Betti measures 1.20 s per inner
-- pack) cannot be represented as a whole number of seconds; rounding to 1 s is a
-- 20% error carried straight into the OEE Performance denominator. Widening an
-- INTEGER to DOUBLE PRECISION preserves every existing value exactly.
ALTER TABLE "machine_cycle_times"
  ALTER COLUMN "cycleTimeSeconds" SET DATA TYPE DOUBLE PRECISION;

-- ── 2. Energy KPI per Work Order × Machine ────────────────────────────
CREATE TABLE "energy_wo_machine_kpis" (
    "id"                   TEXT NOT NULL,
    "factoryId"            TEXT NOT NULL,
    "workOrderId"          TEXT NOT NULL,
    "machineId"            TEXT NOT NULL,
    "meterCount"           INTEGER NOT NULL DEFAULT 0,

    "totalKwh"             DOUBLE PRECISION NOT NULL DEFAULT 0,
    "runningKwh"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "idleKwh"              DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downtimeKwh"          DOUBLE PRECISION NOT NULL DEFAULT 0,

    "kwhPerUnit"           DOUBLE PRECISION,
    "kwhPerKg"             DOUBLE PRECISION,
    "kwhPerRunHour"        DOUBLE PRECISION,
    "productiveKwhPerUnit" DOUBLE PRECISION,
    "wastePct"             DOUBLE PRECISION,

    "baselineKwhPerUnit"   DOUBLE PRECISION,
    "variancePct"          DOUBLE PRECISION,

    "peakPowerKw"          DOUBLE PRECISION,
    "avgPowerKw"           DOUBLE PRECISION,

    "goodQty"              DOUBLE PRECISION,
    "outputUnit"           TEXT,
    "runMinutes"           DOUBLE PRECISION NOT NULL DEFAULT 0,

    "computedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_wo_machine_kpis_pkey" PRIMARY KEY ("id")
);

-- One row per work order per machine — the upsert target.
CREATE UNIQUE INDEX "energy_wo_machine_kpis_workOrderId_machineId_key"
  ON "energy_wo_machine_kpis" ("workOrderId", "machineId");

CREATE INDEX "energy_wo_machine_kpis_factoryId_computedAt_idx"
  ON "energy_wo_machine_kpis" ("factoryId", "computedAt");

CREATE INDEX "energy_wo_machine_kpis_machineId_computedAt_idx"
  ON "energy_wo_machine_kpis" ("machineId", "computedAt");

ALTER TABLE "energy_wo_machine_kpis"
  ADD CONSTRAINT "energy_wo_machine_kpis_factoryId_fkey"
  FOREIGN KEY ("factoryId") REFERENCES "factories" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cascade: the KPI is derived data, meaningless once its work order is gone.
ALTER TABLE "energy_wo_machine_kpis"
  ADD CONSTRAINT "energy_wo_machine_kpis_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "work_orders" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "energy_wo_machine_kpis"
  ADD CONSTRAINT "energy_wo_machine_kpis_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
