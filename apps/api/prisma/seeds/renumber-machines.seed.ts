import { PrismaClient } from '@prisma/client';

/**
 * Close the gaps in machine codes after a machine is retired.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * M2 (Checkweigher) was removed from the line. Its code stayed reserved, so the
 * line read M1 · M3 · M4 · M5 — four machines numbered as if there were five.
 * Every screen that lists them, every tag label carrying a code, and every
 * conversation on the floor then has to carry the explanation "there is no M2".
 *
 * ── Order comes from the ROUTING, not from the codes ────────────────────────
 * Renumbering by sorting the existing codes would just compact whatever order
 * they happen to be in, and would silently entrench a mistake if two machines
 * were ever numbered against the flow. The routing already states the flow —
 * `JobOrder.sequenceOrder` per operation — and that is the authoritative answer
 * to "which machine comes after which". On this line:
 *
 *     1 Filling      Big Betti
 *     2 Cartoning    Cartomac
 *     3 Palletizing  Euro-Pack Robot
 *     4 Wrapping     Uni-tech Wrapping
 *
 * ── What is safe, and why ───────────────────────────────────────────────────
 * Tags bind to a machine by FOREIGN KEY, not by parsing a name, so renaming a
 * code cannot unbind a counter. The tag NAMES that embed an old code are
 * relabelled anyway, because a label reading `..._M04` on a machine now called
 * M3 is worse than no label.
 *
 * Device names are deliberately left alone. `EDGE_COUNTER_M03` is the physical
 * box, not the machine, and it serves several machines' tags; renaming it would
 * change what the gateway is configured against for no gain here.
 *
 * Retired machines are moved OUT of the numbering rather than deleted — their
 * history is real and still referenced by minutes, job orders and downtime.
 * They take an `X-` prefix so a code is never reused by two machines.
 *
 * Idempotent: running it twice changes nothing the second time.
 */
export async function renumberMachines(prisma: PrismaClient, opts: { dryRun?: boolean } = {}) {
  const lines = await prisma.productionLine.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
  });

  const changes: Array<{ line: string; from: string; to: string; name: string }> = [];

  for (const line of lines) {
    const machines = await prisma.machine.findMany({
      where: { lineId: line.id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (machines.length === 0) continue;

    // Flow position per machine, from the routing. A machine that has never run
    // a step has no position; it keeps its place after the ones that have.
    const steps = await prisma.jobOrder.findMany({
      where: { machineId: { in: machines.map((m) => m.id) } },
      select: { machineId: true, sequenceOrder: true },
    });
    const flow = new Map<string, number>();
    for (const s of steps) {
      if (!s.machineId) continue;
      const cur = flow.get(s.machineId);
      // The EARLIEST step a machine appears at is its position: a machine used
      // twice in a routing belongs where it first touches the product.
      if (cur == null || s.sequenceOrder < cur) flow.set(s.machineId, s.sequenceOrder);
    }

    const active = machines.filter((m) => m.isActive);
    const retired = machines.filter((m) => !m.isActive);

    active.sort((a, b) => {
      const fa = flow.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const fb = flow.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return fa !== fb ? fa - fb : a.code.localeCompare(b.code, undefined, { numeric: true });
    });

    // Retired machines first, so the codes they hold are free before the active
    // ones are shifted down into them.
    for (const m of retired) {
      if (m.code.startsWith('X-')) continue;
      const to = `X-${m.code}`;
      changes.push({ line: line.code ?? line.name, from: m.code, to, name: m.name });
      if (!opts.dryRun) await prisma.machine.update({ where: { id: m.id }, data: { code: to } });
    }

    for (const [i, m] of active.entries()) {
      const to = `M${i + 1}`;
      if (m.code === to) continue;
      changes.push({ line: line.code ?? line.name, from: m.code, to, name: m.name });
      if (!opts.dryRun) await prisma.machine.update({ where: { id: m.id }, data: { code: to } });
    }
  }

  // Tag labels that spell out a code. The binding is by id and unaffected; this
  // is so a human reading the tag list is not misled.
  /**
   * Tag codes and names that spell out a machine number.
   *
   * Reconciled against each tag's OWN machine rather than against the changes
   * made above. Keying it to the diff meant it only ran when a machine moved in
   * that same invocation — so a tag left reading `M5_RUN_MODE` after an earlier
   * partial run stayed wrong forever, and re-running the script reported
   * 'already contiguous' while the labels still lied.
   *
   * The binding is by id and unaffected either way; this is so a human reading
   * the tag list is not misled.
   */
  const renamedTags: Array<{ from: string; to: string }> = [];
  const tagged = await prisma.tagDefinition.findMany({
    where: { machineId: { not: null } },
    select: { id: true, name: true, code: true, machine: { select: { code: true } } },
  });
  for (const t of tagged) {
    const owner = t.machine?.code;
    // A retired machine keeps its label: `_M02` on a Checkweigher tag still says
    // which machine it WAS, and `X-M2` inside a tag code would say nothing.
    if (!owner || owner.startsWith('X-')) continue;
    const n = owner.replace(/^M/, '');
    const fix = (text: string | null) =>
      (text == null ? text : text.replace(/M0?(\d)(?!\d)/g,
        (whole) => (whole.includes('M0') ? `M0${n}` : `M${n}`)));
    const nextName = fix(t.name);
    const nextCode = fix(t.code);
    const nameChanged = nextName !== t.name;
    const codeChanged = nextCode !== t.code;
    if (!nameChanged && !codeChanged) continue;
    renamedTags.push({ from: t.code ?? t.name ?? '', to: (nextCode ?? nextName) ?? '' });
    if (!opts.dryRun) {
      await prisma.tagDefinition.update({
        where: { id: t.id },
        data: {
          ...(nameChanged && nextName != null ? { name: nextName } : {}),
          ...(codeChanged && nextCode != null ? { code: nextCode } : {}),
        },
      });
    }
  }

  return { changes, renamedTags };
}
