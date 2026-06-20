-- Polymorphic attachments (instruction files + work-evidence photos) for maintenance & quality.
CREATE TABLE IF NOT EXISTS "attachments" (
    "id"             TEXT NOT NULL,
    "factoryId"      TEXT NOT NULL,
    "entityType"     TEXT NOT NULL,
    "entityId"       TEXT NOT NULL,
    "category"       TEXT NOT NULL DEFAULT 'EVIDENCE',
    "storageKey"     TEXT NOT NULL,
    "originalName"   TEXT NOT NULL,
    "mimeType"       TEXT NOT NULL,
    "size"           INTEGER NOT NULL,
    "description"    TEXT,
    "uploadedById"   TEXT,
    "uploadedByName" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "attachments_factoryId_idx" ON "attachments"("factoryId");
