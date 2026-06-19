-- A Work Order spans multiple machines via its Job Orders (each Job Order links a
-- RoutingStep -> Machine). The single header machine on work_orders was incorrect,
-- so it is removed. Machine scope is now derived from the WO's job orders.
DROP INDEX IF EXISTS "work_orders_machineId_idx";
ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_machineId_fkey";
ALTER TABLE "work_orders" DROP COLUMN IF EXISTS "machineId";
