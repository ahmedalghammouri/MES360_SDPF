import { PrismaClient } from '@prisma/client';

/**
 * The signal that makes Big Betti's starvation visible.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * State inference can only tell STARVED from BREAKDOWN when the machine reports
 * whether product is actually moving through it. Without that, a machine in Run
 * Mode with nothing to do is indistinguishable from one that has faulted, and
 * the inference deliberately declines to guess — it leaves the raw state alone
 * rather than charge an external loss to the wrong machine.
 *
 * Only the wrapper had such a signal (its table rotation). Big Betti had none,
 * so this rule could never fire for it:
 *
 *     RUN_MODE  CARTON_PUSHER   downstream            Big Betti is
 *     ────────  ─────────────   ───────────────────   ─────────────
 *        1            1         any                   RUNNING
 *        1            0         breakdown / blocked   BLOCKED
 *        1            0         running               STARVED
 *        0            x         breakdown / blocked   BLOCKED
 *        0            x         running               BREAKDOWN
 *
 * The carton pusher IS that signal: it cycles once per pack pushed, so it is
 * active exactly when product is moving through the filler.
 *
 * ── Why downstream-STARVED is not in the table ──────────────────────────────
 * A machine can only starve because the one before it stopped. So if Cartomac
 * is STARVED, the cause is Big Betti — and calling Big Betti BLOCKED for it
 * would be circular: each machine excusing itself with the other. The inference
 * already guards this (`notAccepting` passes STARVED as the excuse), which is
 * why the condition column reads "breakdown / blocked" and not "not running".
 *
 * ── The address ─────────────────────────────────────────────────────────────
 * DI5 on EDGECOUNTER01 — the next free discrete input on the box that already
 * carries Big Betti's counters and Run Mode (0-4 are in use). CONFIRM THIS
 * AGAINST THE FIELD WIRING: which input the pusher lands on is a fact about the
 * panel, not something this file can know. Change `ADDRESS` if it differs; the
 * rest holds.
 *
 * Idempotent — keyed on the tag name.
 */
// The address column is a STRING: these are device addresses, not numbers to
// do arithmetic on, and some protocols address by name.
const ADDRESS = '5';
const TAG_NAME = 'M1_CARTON_PUSHER';

export async function seedM1CartonPusher(prisma: PrismaClient) {
  const machine = await prisma.machine.findFirst({
    where: { name: { contains: 'Big Betti', mode: 'insensitive' } },
    select: { id: true, code: true, name: true, factoryId: true },
  });
  if (!machine) return { skipped: 'Big Betti not found' as const };

  // The box Big Betti's Run Mode already comes from — same panel, same poll.
  const runMode = await prisma.tagDefinition.findFirst({
    where: { machineId: machine.id, signalRole: 'RUN_MODE' },
    select: { deviceId: true, pollIntervalMs: true },
  });
  if (!runMode?.deviceId) return { skipped: 'Big Betti has no RUN_MODE tag to inherit a device from' as const };

  const existing = await prisma.tagDefinition.findFirst({
    where: { code: TAG_NAME },
    select: { id: true },
  });

  const data = {
    factoryId: machine.factoryId,
    machineId: machine.id,
    deviceId: runMode.deviceId,
    // `code` is the tag's stable identifier and is required; `name` is the
    // label. Both are the same here because the field wiring calls it this.
    code: TAG_NAME,
    name: TAG_NAME,
    description: 'Carton pusher cycle — active while product is moving through the filler. '
      + 'Bound as PROCESSING so STARVED can be told apart from BREAKDOWN.',
    address: ADDRESS,
    dataType: 'BOOL',
    signalRole: 'PROCESSING',
    /**
     * How long the pusher may rest before the filler counts as not processing.
     *
     * Big Betti runs ~1.2 s per inner pack, so a gap of seconds is a normal
     * cycle and a gap of a minute is not. 60 s is deliberately generous: the
     * cost of being late to call STARVED is a minute of misattributed time,
     * while the cost of being early is calling a working machine starved every
     * time it pauses between packs.
     */
    idleThresholdMs: 60_000,
    isActive: true,
    ...(runMode.pollIntervalMs ? { pollIntervalMs: runMode.pollIntervalMs } : {}),
  };

  if (existing) {
    await prisma.tagDefinition.update({ where: { id: existing.id }, data });
    return { updated: TAG_NAME, machine: `${machine.code} ${machine.name}`, address: ADDRESS };
  }
  await prisma.tagDefinition.create({ data: data as never });
  return { created: TAG_NAME, machine: `${machine.code} ${machine.name}`, address: ADDRESS };
}
