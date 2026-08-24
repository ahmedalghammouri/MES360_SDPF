-- Startup is a state the plant has, and had nowhere to put.
--
-- The production schedule opens every shift with a Startup block (30 minutes on
-- this line, right after Cleaning). It was reachable as a downtime CAUSE
-- (PD-STARTUP) but filed under CHANGEOVER, and it existed nowhere as a machine
-- state — so the minutes landed in IDLE and were charged as unplanned downtime,
-- and nobody creating a planned stop could pick it.
--
-- Two enums, because the two answer different questions: MachineState is what
-- the machine IS, DowntimeCategory is what the stop was FOR.
--
-- ALTER TYPE ... ADD VALUE is transactional from PostgreSQL 12 onward (this
-- stack runs 16). The new labels are only DECLARED here; nothing writes them in
-- this transaction, which is the one restriction that still applies.

ALTER TYPE "MachineState"     ADD VALUE IF NOT EXISTS 'STARTUP';
ALTER TYPE "DowntimeCategory" ADD VALUE IF NOT EXISTS 'STARTUP';
