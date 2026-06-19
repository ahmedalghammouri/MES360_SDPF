-- Batch ↔ one-or-more Work Orders, with an AUTO/MANUAL quantity source.
-- AUTO = batch.quantity is the live sum of linked WO planned quantities; MANUAL = entered/edited.
ALTER TABLE "batch_records" ADD COLUMN IF NOT EXISTS "workOrderIds" JSONB;
ALTER TABLE "batch_records" ADD COLUMN IF NOT EXISTS "quantitySource" TEXT NOT NULL DEFAULT 'MANUAL';
