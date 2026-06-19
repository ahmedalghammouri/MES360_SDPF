-- Machine-status driver tag + value→state map. Counters only accumulate while RUNNING.
ALTER TABLE "tag_definitions" ADD COLUMN IF NOT EXISTS "isMachineStatus" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tag_definitions" ADD COLUMN IF NOT EXISTS "statusMap" JSONB;
