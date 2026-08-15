-- ============================================================
-- Scope 2 carbon footprint — grid emission factor  (NCC PoC items 26 & 27)
-- ============================================================
-- Scope 2 (purchased electricity, location-based) emissions are:
--     kg CO2e = kWh consumed × grid emission factor
--
-- NCC supplied 0.568 kg CO2e/kWh for the KSA grid. The acceptance criterion is
-- explicit that this must be "stored as a configurable value ... displayed with
-- its unit and effective source/date" — so it is a versioned row here, never a
-- constant in code. Versioning by effective date means a historical period keeps
-- the factor that was in force at the time, which is what an audited GHG report
-- requires.
--
-- Purely additive: a new table only. Safe to apply to the live database.

CREATE TABLE "grid_emission_factors" (
    "id"             TEXT NOT NULL,
    "factoryId"      TEXT NOT NULL,
    "factorKgPerKwh" DOUBLE PRECISION NOT NULL,
    "unit"           TEXT NOT NULL DEFAULT 'kg CO2e/kWh',
    "source"         TEXT,
    "effectiveFrom"  TIMESTAMP(3) NOT NULL,
    "effectiveTo"    TIMESTAMP(3),
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grid_emission_factors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grid_emission_factors_factoryId_isActive_effectiveFrom_idx"
    ON "grid_emission_factors" ("factoryId", "isActive", "effectiveFrom");

ALTER TABLE "grid_emission_factors"
    ADD CONSTRAINT "grid_emission_factors_factoryId_fkey"
    FOREIGN KEY ("factoryId") REFERENCES "factories" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the NCC-supplied KSA grid factor for every existing factory, effective
-- from the start of the PoC evaluation. Editable afterwards through the API.
INSERT INTO "grid_emission_factors"
    ("id", "factoryId", "factorKgPerKwh", "unit", "source", "effectiveFrom", "isActive", "notes", "updatedAt")
SELECT
    gen_random_uuid()::text,
    f."id",
    0.568,
    'kg CO2e/kWh',
    'NCC-supplied KSA national grid emission factor (PoC baseline)',
    TIMESTAMP '2026-01-01 00:00:00',
    true,
    'Confirm with NCC whether this is fixed for the PoC or must track an updated published factor.',
    CURRENT_TIMESTAMP
FROM "factories" f;
