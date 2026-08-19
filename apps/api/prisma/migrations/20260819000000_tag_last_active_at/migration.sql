-- The last moment a signal was known to be ACTIVE, as opposed to the last moment
-- its value was WRITTEN. Starvation detection asked the first question and read
-- the second; they agree until the gateway restarts, which rewrites every tag's
-- timestamp and erases however long the signal had actually been idle.
ALTER TABLE "tag_current_values" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Seed from the existing timestamp so behaviour is unchanged for rows that have
-- one, rather than every machine reading "never active" on the first deploy.
UPDATE "tag_current_values" SET "lastActiveAt" = "timestamp";
