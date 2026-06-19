-- Energy cost tariff (scoped rate: machine > line > area > factory default).
CREATE TABLE IF NOT EXISTS "energy_tariffs" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "energyType" "EnergyType" NOT NULL,
    "machineId" TEXT,
    "lineId" TEXT,
    "areaId" TEXT,
    "ratePerUnit" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "energy_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "energy_tariffs_factoryId_energyType_isActive_idx" ON "energy_tariffs"("factoryId", "energyType", "isActive");

DO $$ BEGIN
  ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "energy_tariffs" ADD CONSTRAINT "energy_tariffs_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
