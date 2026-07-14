-- Per-tag publish + historization modes for the edge gateway.
-- CHANGE = emit only when the value moves by at least "deadband";
-- RATE   = emit at most once per *RateSec window (0 = every poll).
ALTER TABLE "tag_definitions" ADD COLUMN "mqttPublishMode" TEXT NOT NULL DEFAULT 'CHANGE';
ALTER TABLE "tag_definitions" ADD COLUMN "mqttPublishRateSec" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tag_definitions" ADD COLUMN "historizationMode" TEXT NOT NULL DEFAULT 'CHANGE';
ALTER TABLE "tag_definitions" ADD COLUMN "deadband" DOUBLE PRECISION;
