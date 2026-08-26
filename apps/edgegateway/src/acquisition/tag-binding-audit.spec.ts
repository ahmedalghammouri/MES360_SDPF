/**
 * The configuration audit must name real traps and only real traps.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The first version of this audit compared a tag's name against `t.address`
 * with `!==`. `address` is a STRING column — it holds "100" and "40001" for
 * register types where the leading digit carries meaning — so the comparison
 * was always unequal and every tag on the plant was flagged, the seven that
 * agree along with the three that do not.
 *
 * That failure is worse than no audit. Seven findings where three are real
 * teaches a reader to skim the list, and the next genuine mismatch goes past
 * them. So the rule is pinned in both directions: a matching binding must
 * produce SILENCE, and only a real disagreement may speak.
 *
 * The logic is duplicated here rather than imported because it lives inside a
 * Nest service that would drag a Prisma client and a poller into a unit test.
 * The duplication is deliberate and narrow — if the service's rule changes,
 * this file is the one place that has to follow it, and a divergence showing up
 * as a failure here is the signal worth having.
 */

interface Tag {
  code: string;
  address: string | null;
  tagType: string;
  counterRole?: string | null;
  edgeType?: string | null;
  machine?: { code: string } | null;
}

/** The audit, as `auditTagBindings` applies it to one device. */
function auditDevice(name: string, tags: Tag[]): string[] {
  const notes: string[] = [];

  for (const t of tags) {
    const named = /DI(\d+)/i.exec(t.code ?? '');
    if (!named || t.address === null || t.address === undefined) continue;
    const actual = Number(t.address);
    if (!Number.isFinite(actual)) continue;
    if (Number(named[1]) !== actual) {
      notes.push(`${name} · ${t.code} is named DI${named[1]} but reads input ${actual}`);
    }
  }

  const byAddress = new Map<string, string[]>();
  for (const t of tags) {
    if (t.address === null) continue;
    const list = byAddress.get(t.address) ?? [];
    list.push(t.code);
    byAddress.set(t.address, list);
  }
  for (const [addr, codes] of byAddress) {
    if (codes.length > 1) {
      notes.push(`${name} · input ${addr} is read by ${codes.length} active tags: ${codes.join(', ')}`);
    }
  }

  const byMachine = new Map<string, Tag[]>();
  for (const t of tags) {
    if (t.tagType !== 'COUNTER' || !t.machine) continue;
    const list = byMachine.get(t.machine.code) ?? [];
    list.push(t);
    byMachine.set(t.machine.code, list);
  }
  for (const [code, list] of byMachine) {
    const edges = new Set(list.map((t) => t.edgeType));
    if (edges.size > 1) {
      notes.push(`${name} · ${code} counts on two different edges: `
        + list.map((t) => `${t.counterRole}=${t.edgeType}`).join(' ')
        + ' — the pair will respond differently to the same contact ring');
    }
  }

  return notes;
}

const counter = (code: string, address: string, machine: string, role: string, edge: string): Tag =>
  ({ code, address, tagType: 'COUNTER', counterRole: role, edgeType: edge, machine: { code: machine } });

describe('the tag binding audit', () => {
  it('says nothing when a name and an address agree', () => {
    // The bug that made the first version useless: "0" is a string, and
    // 0 !== "0" is true.
    expect(auditDevice('EDGECOUNTER01', [
      counter('EDGECOUNTER01_DI0_M01', '0', 'M1', 'TOTAL', 'RISING'),
      counter('EDGECOUNTER01_DI1', '1', 'M1', 'GOOD', 'RISING'),
    ])).toEqual([]);
  });

  it('names a tag whose address is not the one in its name', () => {
    const notes = auditDevice('EDGE_COUNTER_M03', [
      counter('EDGE_COUNTER_M03_DI3', '2', 'M3', 'GOOD', 'FALLING'),
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('named DI3 but reads input 2');
  });

  it('reproduces the plant exactly — four findings, not seven', () => {
    // The live configuration on 26 Aug 2026. Three genuine name mismatches and
    // one mixed pair; everything else agrees and must stay silent.
    const notes = auditDevice('EDGE_COUNTER_M03', [
      counter('EDGE_COUNTER_M02_DI1', '0', 'M2', 'GOOD', 'RISING'),
      counter('EDGE_COUNTER_M02_DI0', '1', 'M2', 'TOTAL', 'FALLING'),
      counter('EDGE_COUNTER_M03_DI3', '2', 'M3', 'GOOD', 'FALLING'),
      counter('EDGE_COUNTER_M04_DI3', '3', 'M4', 'GOOD', 'RISING'),
    ]);
    expect(notes).toHaveLength(4);
    expect(notes.filter((n) => n.includes('named DI'))).toHaveLength(3);
    expect(notes.find((n) => n.includes('two different edges'))).toContain('M2');
  });

  it('leaves a machine alone when its counters share one edge', () => {
    expect(auditDevice('D', [
      counter('D_DI0', '0', 'M1', 'TOTAL', 'RISING'),
      counter('D_DI1', '1', 'M1', 'GOOD', 'RISING'),
    ])).toEqual([]);
  });

  it('catches two live tags reading one input', () => {
    const notes = auditDevice('D', [
      counter('D_DI2', '2', 'M3', 'GOOD', 'FALLING'),
      counter('D_DI2_TOTAL', '2', 'M3', 'TOTAL', 'FALLING'),
    ]);
    expect(notes.find((n) => n.includes('read by 2 active tags'))).toBeTruthy();
  });

  it('skips an address that is not a number rather than guessing', () => {
    // Register addresses like "40001" are numeric, but a malformed one must not
    // become a finding invented out of NaN.
    expect(auditDevice('D', [
      { code: 'D_DI1', address: 'coil-1', tagType: 'COUNTER', counterRole: 'GOOD', edgeType: 'RISING', machine: { code: 'M1' } },
    ])).toEqual([]);
  });

  it('ignores a tag whose name carries no DI number at all', () => {
    expect(auditDevice('D', [
      counter('M1_RUN_MODE', '2', 'M1', 'NONE', 'RISING'),
    ])).toEqual([]);
  });

  it('says nothing about a clean device', () => {
    // The state the plant should reach. Silence has to be reachable, or the
    // audit becomes background noise that nobody can ever clear.
    expect(auditDevice('CLEAN', [
      counter('CLEAN_DI0', '0', 'M1', 'TOTAL', 'RISING'),
      counter('CLEAN_DI1', '1', 'M1', 'GOOD', 'RISING'),
      counter('CLEAN_DI2', '2', 'M2', 'TOTAL', 'FALLING'),
      counter('CLEAN_DI3', '3', 'M2', 'GOOD', 'FALLING'),
    ])).toEqual([]);
  });
});
