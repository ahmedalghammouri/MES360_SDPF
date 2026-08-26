-- A production order's known stops, and a shift's real breaks.
--
-- Both replace something the plant was typing in by hand every time. The plan
-- lives here; the EVENTS are created from it when an order actually starts or a
-- shift actually begins — so editing a plan tomorrow cannot rewrite yesterday.

CREATE TYPE "StopRecurrence" AS ENUM ('ONCE', 'PER_SHIFT', 'PER_RESTART');

CREATE TABLE "production_order_stops" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "recurrence" "StopRecurrence" NOT NULL DEFAULT 'ONCE',
    "affectsOEE" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "production_order_stops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_order_stops_productionOrderId_idx"
    ON "production_order_stops"("productionOrderId");

ALTER TABLE "production_order_stops"
    ADD CONSTRAINT "production_order_stops_productionOrderId_fkey"
    FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shift_breaks" (
    "id" TEXT NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "affectsOEE" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shift_breaks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shift_breaks_shiftTemplateId_idx" ON "shift_breaks"("shiftTemplateId");

ALTER TABLE "shift_breaks"
    ADD CONSTRAINT "shift_breaks_shiftTemplateId_fkey"
    FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
