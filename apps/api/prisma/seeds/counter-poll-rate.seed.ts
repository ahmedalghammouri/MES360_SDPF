import type { PrismaClient } from '@prisma/client';

/**
 * Poll fast enough to see the pulses being counted.
 *
 * ── Why this is configuration and not a constant ────────────────────────────
 * A counter is accurate when the gateway looks at the contact several times
 * while it is closed. Miss that and nothing reports an error: the tag reads as
 * a steady level and the count simply comes out low. On 23 Aug 2026 the packing
 * line produced 44 cartons and the gateway recorded 4.
 *
 * Two things caused that. The read loop was waiting on the server between
 * samples — fixed in the gateway itself, where it belonged. The other half is
 * here: the interval a device is polled at is plant data, because it depends on
 * how the machine's sensor is wired and how fast its network answers. It lives
 * in `devices.pollIntervalMs`, and the gateway re-reads it every ten seconds,
 * so it can be tuned against a running line without rebuilding anything.
 *
 * ── Why 20 ms ───────────────────────────────────────────────────────────────
 * It is a ceiling, not a promise. The gateway skips a tick whose predecessor is
 * still running, so the real sample rate is whichever is SLOWER: this interval,
 * or the device's Modbus round-trip. Asking for 20 ms therefore means "sample as
 * fast as this device can answer", and the gateway reports what it achieved:
 *
 *   EDGECOUNTER01: sampling at its limit — the Modbus round-trip alone takes 34ms
 *
 * Read that line together with the pulse width the counter reports, and the
 * right number for this plant is known rather than guessed.
 *
 * Only devices that actually carry a counter tag are touched. A meter polled
 * once a second is left alone — there is nothing to alias in an energy reading,
 * and polling it fast would only add traffic.
 */
export const COUNTER_POLL_MS = 20;

export async function setCounterPollRate(
  prisma: PrismaClient,
  opts: { dryRun?: boolean; intervalMs?: number } = {},
): Promise<Array<{ device: string; from: number | null; to: number }>> {
  const target = opts.intervalMs ?? COUNTER_POLL_MS;

  const counterTags = await prisma.tagDefinition.findMany({
    where: { isActive: true, deviceId: { not: null }, counterRole: { in: ['TOTAL', 'GOOD', 'BAD'] as any } },
    select: { deviceId: true },
  });
  const deviceIds = [...new Set(counterTags.map((t) => t.deviceId!).filter(Boolean))];
  if (deviceIds.length === 0) return [];

  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds } },
    select: { id: true, name: true, pollIntervalMs: true },
  });

  const changes: Array<{ device: string; from: number | null; to: number }> = [];
  for (const d of devices) {
    // Only ever make it faster. A plant that has deliberately slowed a device —
    // a flaky link, a device that cannot take the traffic — has made a decision,
    // and a seed that runs on every boot must not keep overriding it.
    if (d.pollIntervalMs !== null && d.pollIntervalMs <= target) continue;
    changes.push({ device: d.name, from: d.pollIntervalMs, to: target });
    if (!opts.dryRun) {
      await prisma.device.update({ where: { id: d.id }, data: { pollIntervalMs: target } });
    }
  }
  return changes;
}
