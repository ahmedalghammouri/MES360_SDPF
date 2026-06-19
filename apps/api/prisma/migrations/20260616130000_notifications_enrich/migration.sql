-- Notifications enrichment: explicit UI category + severity + deep link, and
-- per-user channel preferences. Unifies the persisted + real-time notification feed.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "NotificationCategory" AS ENUM (
    'ALARM', 'PRODUCTION', 'QUALITY', 'MAINTENANCE', 'DOWNTIME', 'ENERGY', 'INVENTORY', 'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationSeverity" AS ENUM (
    'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── notifications: new columns ──────────────────────────────────────────────
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link" TEXT;

-- Backfill category/severity from the existing type/priority for legacy rows.
UPDATE "notifications" SET "category" = CASE "type"::text
    WHEN 'ALARM'       THEN 'ALARM'
    WHEN 'DOWNTIME'    THEN 'DOWNTIME'
    WHEN 'PRODUCTION'  THEN 'PRODUCTION'
    WHEN 'QUALITY'     THEN 'QUALITY'
    WHEN 'MAINTENANCE' THEN 'MAINTENANCE'
    WHEN 'ENERGY'      THEN 'ENERGY'
    ELSE 'SYSTEM'
  END::"NotificationCategory"
  WHERE "category" = 'SYSTEM';

UPDATE "notifications" SET "severity" = CASE "priority"::text
    WHEN 'CRITICAL' THEN 'CRITICAL'
    WHEN 'HIGH'     THEN 'ERROR'
    WHEN 'MEDIUM'   THEN 'WARNING'
    WHEN 'LOW'      THEN 'INFO'
    WHEN 'INFO'     THEN 'INFO'
    ELSE 'INFO'
  END::"NotificationSeverity"
  WHERE "severity" = 'INFO';

CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- ── notification_preferences ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "minSeverity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_userId_category_key" ON "notification_preferences"("userId", "category");

DO $$ BEGIN
  ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
