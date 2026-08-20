#!/usr/bin/env node
/**
 * OEE verification run — a shift whose answer is known before it starts.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * Every other check on this engine compares it with itself. This one does not:
 * the scenario below DECIDES what the machine did, minute by minute, and works
 * out the OEE that must follow from the published formulas. The engine is then
 * asked the same question through its own API. If the two disagree, one of them
 * is wrong, and the scenario is the one you can read in twenty lines.
 *
 * Time is compressed. The scenario writes machine states and counter values at
 * synthetic timestamps and drives the minute writer through them, so an
 * eight-hour shift is verified in a few seconds instead of eight hours.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd apps/api
 *   node scripts/oee-scenario.mjs                    # the default shift
 *   node scripts/oee-scenario.mjs --scenario starved # a line-constrained shift
 *   node scripts/oee-scenario.mjs --keep             # leave the rows for the UI
 *
 * Env: API_URL (default http://localhost:8080/api/v1)
 *      API_EMAIL / API_PASSWORD (default the seeded admin)
 *      DATABASE_URL (from .env — the states and counters are written directly)
 */
import { PrismaClient } from '@prisma/client';

const API = (process.env.API_URL || 'http://localhost:8080/api/v1').replace(/\/$/, '');
const EMAIL = process.env.API_EMAIL || 'admin@mes360.sa';
const PASSWORD = process.env.API_PASSWORD || 'Password@123';
const KEEP = process.argv.includes('--keep');
const WANTED = (process.argv[process.argv.indexOf('--scenario') + 1] || 'default').replace(/^--.*/, 'default');

const MIN = 60_000;
const prisma = new PrismaClient();

/**
 * The scenarios.
 *
 * Each step is a run of whole minutes in one machine state, producing at a fixed
 * rate. Whole minutes on purpose: a step that ended mid-minute would split a
 * bucket, and then the expected answer would depend on the same interval
 * arithmetic the engine is being tested on. The point is to check the engine
 * against something simpler than itself.
 *
 *   state       what the machine reported
 *   minutes     how long it held that state
 *   partsPerMin parts completed per minute (0 while stopped)
 *   rejectPct   share of those parts that were rejected
 */
const SCENARIOS = {
  /**
   * A believable shift: runs, breaks down, is repaired, changes over, runs again.
   * Design speed is 60 parts/hour = 1 per minute, so a minute of running at
   * 1 part/min is exactly 100% performance and any slower rate is a speed loss
   * you can compute in your head.
   */
  default: {
    label: 'A four-hour shift with one breakdown and one changeover',
    designCycleSec: 60,
    steps: [
      { state: 'RUNNING', minutes: 90, partsPerMin: 1.0, rejectPct: 2 },
      { state: 'BREAKDOWN', minutes: 25, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 45, partsPerMin: 0.8, rejectPct: 2 },
      { state: 'CHANGEOVER', minutes: 20, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 5 },
    ],
  },

  /**
   * The same machine, stopped by the line rather than by itself. Availability
   * must NOT move: starvation is carved out above planned production time.
   * Run this one against `default` to see the difference a State Rule makes.
   */
  starved: {
    label: 'A shift where the constraint is upstream, not this machine',
    designCycleSec: 60,
    steps: [
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 1 },
      { state: 'STARVED', minutes: 90, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 1 },
    ],
  },

  /**
   * A machine with no status signal at all. Every minute is unmeasured, so the
   * engine must report NO availability — not 0%, and certainly not 100%.
   */
  silent: {
    label: 'A machine that reports nothing',
    designCycleSec: 60,
    steps: [{ state: null, minutes: 60, partsPerMin: 0, rejectPct: 0 }],
  },
};

/** What the reference formulas say this scenario must produce. */
function expected(scenario) {
  const producing = new Set(['RUNNING']);
  // Mirrors the fallback State Rules the writer uses when the plant has none.
  const planned = new Set(['CHANGEOVER', 'SETUP', 'PLANNED_STOP', 'MAINTENANCE']);
  const external = new Set(['STARVED', 'BLOCKED', 'OFFLINE']);

  let totalMin = 0, plannedStopMin = 0, availabilityLossMin = 0;
  let externalLossMin = 0, unmeasuredMin = 0, operatingMin = 0;
  let good = 0, rejected = 0;

  for (const s of scenario.steps) {
    totalMin += s.minutes;
    if (s.state == null) unmeasuredMin += s.minutes;
    else if (producing.has(s.state)) operatingMin += s.minutes;
    else if (planned.has(s.state)) plannedStopMin += s.minutes;
    else if (external.has(s.state)) externalLossMin += s.minutes;
    else availabilityLossMin += s.minutes;

    const parts = s.minutes * s.partsPerMin;
    const bad = parts * (s.rejectPct / 100);
    good += parts - bad;
    rejected += bad;
  }

  const designSpeedPph = 3600 / scenario.designCycleSec;
  const theoretical = (operatingMin / 60) * designSpeedPph;

  const operationalMin = Math.max(0, totalMin - plannedStopMin - externalLossMin - unmeasuredMin);
  const totalParts = good + rejected;

  const ratio = (n, d) => (d > 0 ? (n / d) * 100 : null);
  const cap = (n) => (n == null ? null : Math.min(100, n));
  const availability = cap(ratio(operatingMin, operationalMin));
  const performance = cap(ratio(totalParts, theoretical));
  const quality = cap(ratio(good, totalParts));
  const oee = availability != null && performance != null && quality != null
    ? (availability / 100) * (performance / 100) * (quality / 100) * 100
    : null;

  return {
    totalMin, plannedStopMin, availabilityLossMin, externalLossMin, unmeasuredMin,
    operatingMin, operationalMin,
    good, rejected, totalParts, theoretical,
    availability, performance, quality, oee,
  };
}

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const fmt = (n) => (n == null ? '  —  ' : `${r1(n).toFixed(1)}`.padStart(6));

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}) — is the API up at ${API}?`);
  const body = await res.json();
  const token = body.accessToken || body.access_token || body.token;
  if (!token) throw new Error('login returned no token');
  return token;
}

async function main() {
  const scenario = SCENARIOS[WANTED];
  if (!scenario) {
    console.error(`Unknown scenario "${WANTED}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };

  // A job order to attach the run to. An existing one is reused so the scenario
  // exercises the same relations production does; a throwaway would test a
  // shape the plant never has.
  const jo = await prisma.jobOrder.findFirst({
    where: { machineId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, machineId: true, factoryId: true, workOrderId: true, operationName: true },
  });
  if (!jo) throw new Error('no job order in the database to run the scenario against');

  const totalMinutes = scenario.steps.reduce((a, s) => a + s.minutes, 0);
  // Anchor far enough back that the run cannot collide with live data, and on a
  // whole minute so every step boundary is a bucket boundary.
  const t0 = new Date(Math.floor((Date.now() - (totalMinutes + 5) * MIN) / MIN) * MIN);
  const tEnd = new Date(t0.getTime() + totalMinutes * MIN);

  console.log(`\n  OEE verification run — ${scenario.label}`);
  console.log(`  job order ${jo.operationName ?? jo.id} on machine ${jo.machineId}`);
  console.log(`  ${totalMinutes} synthetic minutes from ${t0.toLocaleString()}\n`);

  // ── Save what we are about to overwrite ─────────────────────────────────
  const saved = await prisma.jobOrder.findUnique({
    where: { id: jo.id },
    select: { status: true, actualStart: true, actualEnd: true, idealCycleTimeSec: true, actualQtyGood: true, actualQtyRejected: true },
  });

  try {
    await prisma.oeeMinute.deleteMany({ where: { jobOrderId: jo.id, bucketStart: { gte: t0, lt: tEnd } } });
    await prisma.machineStateRecord.deleteMany({ where: { machineId: jo.machineId, startTime: { gte: t0, lt: tEnd } } });

    await prisma.jobOrder.update({
      where: { id: jo.id },
      data: {
        status: 'EXECUTING', actualStart: t0, actualEnd: null,
        idealCycleTimeSec: scenario.designCycleSec,
        actualQtyGood: 0, actualQtyRejected: 0,
      },
    });

    // ── Replay ────────────────────────────────────────────────────────────
    let cursor = t0.getTime();
    let good = 0, rejected = 0;
    for (const step of scenario.steps) {
      const from = new Date(cursor);
      const to = new Date(cursor + step.minutes * MIN);

      if (step.state) {
        await prisma.machineStateRecord.create({
          data: {
            machineId: jo.machineId, factoryId: jo.factoryId, state: step.state,
            startTime: from, endTime: to,
            durationMinutes: step.minutes,
          },
        });
      }

      for (let m = 0; m < step.minutes; m++) {
        const parts = step.partsPerMin;
        const bad = parts * (step.rejectPct / 100);
        good += parts - bad;
        rejected += bad;
        // The counters are cumulative on the job order, exactly as the gateway
        // writes them — the writer's delta logic is part of what is under test.
        await prisma.jobOrder.update({
          where: { id: jo.id },
          data: { actualQtyGood: good, actualQtyRejected: rejected },
        });

        // Capture the minute that has just closed: pass the START of the next.
        const at = new Date(cursor + (m + 1) * MIN);
        const res = await fetch(`${API}/oee-standard/capture?at=${encodeURIComponent(at.toISOString())}`, {
          method: 'POST', headers: auth,
        });
        if (!res.ok) throw new Error(`capture failed (${res.status}) at ${at.toISOString()}`);
      }
      cursor = to.getTime();
      process.stdout.write(`  ${String(step.state ?? 'no state').padEnd(12)} ${String(step.minutes).padStart(4)} min  ✓\n`);
    }

    // ── Ask the engine ────────────────────────────────────────────────────
    const url = new URL(`${API}/oee-standard`);
    url.searchParams.set('jobOrderId', jo.id);
    url.searchParams.set('dateFrom', ymd(t0));
    url.searchParams.set('dateTo', ymd(tEnd));
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`read failed (${res.status})`);
    const actual = await res.json();
    const exp = expected(scenario);

    report(exp, actual);
  } finally {
    if (KEEP) {
      console.log(`\n  --keep: rows left in place. Open /oee-standard and pick ${ymd(t0)}.`);
    } else {
      await prisma.oeeMinute.deleteMany({ where: { jobOrderId: jo.id, bucketStart: { gte: t0, lt: tEnd } } });
      await prisma.machineStateRecord.deleteMany({ where: { machineId: jo.machineId, startTime: { gte: t0, lt: tEnd } } });
      await prisma.jobOrder.update({ where: { id: jo.id }, data: saved });
      console.log('\n  scenario rows removed, job order restored');
    }
    await prisma.$disconnect();
  }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Side by side, with the verdict computed rather than eyeballed. */
function report(exp, got) {
  const rows = [
    ['Total time', exp.totalMin, got.time.totalMin, 'min'],
    ['Planned stops', exp.plannedStopMin, got.time.plannedStopMin, 'min'],
    ['External loss', exp.externalLossMin, got.time.externalLossMin, 'min'],
    ['Unmeasured', exp.unmeasuredMin, got.time.unmeasuredMin, 'min'],
    ['Operational time', exp.operationalMin, got.time.operationalMin, 'min'],
    ['Availability losses', exp.availabilityLossMin, got.time.availabilityLossMin, 'min'],
    ['Net production time', exp.operatingMin, got.time.netProductionMin, 'min'],
    ['Good parts', exp.good, got.counts.good, ''],
    ['Rejected parts', exp.rejected, got.counts.rejected, ''],
    ['Theoretical parts', exp.theoretical, got.counts.theoretical, ''],
    ['Availability', exp.availability, got.availability, '%'],
    ['Performance', exp.performance, got.performance, '%'],
    ['Quality', exp.quality, got.quality, '%'],
    ['OEE', exp.oee, got.oee, '%'],
  ];

  console.log('\n  ┌────────────────────────┬────────┬────────┬──────┐');
  console.log('  │                        │ expect │ engine │      │');
  console.log('  ├────────────────────────┼────────┼────────┼──────┤');
  let failures = 0;
  for (const [label, e, a, unit] of rows) {
    // A tenth of a unit is float noise over a few hundred minutes; anything
    // larger is a disagreement worth reading.
    const ok = e == null && a == null ? true : e != null && a != null && Math.abs(e - a) <= 0.1;
    if (!ok) failures++;
    console.log(`  │ ${label.padEnd(22)} │ ${fmt(e)} │ ${fmt(a)} │ ${ok ? ' ok ' : 'FAIL'} │${unit ? ` ${unit}` : ''}`);
  }
  console.log('  └────────────────────────┴────────┴────────┴──────┘');

  console.log(`\n  engine self-audit: ${got.audit.ok ? 'every minute accounted for' : 'MINUTES DO NOT RECONCILE'}`
    + `  (bucket drift ${got.audit.bucketDriftMin}m, identity drift ${got.audit.identityDriftMin}m)`);

  if (failures === 0 && got.audit.ok) {
    console.log('\n  ✓ the engine reproduced the scenario exactly\n');
  } else {
    console.log(`\n  ✗ ${failures} value(s) disagree — the scenario is the readable one; start there\n`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(`\n  scenario failed: ${err.message}\n`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
