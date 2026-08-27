#!/usr/bin/env bash
# Did the gateway count what the simulator emitted?
#
# Run it whenever you like while everything is up; it changes nothing.
#
# The simulator's tally is the reference because it is the only number produced
# by the thing that made the pulses. Everything else -- the job order totals,
# the minute store, the gateway's own accumulators -- is measured against it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WO="${WO:-WO-2026-0005}"
TALLY="${TALLY:-$HERE/sim-tally.json}"
PG="docker exec -i mes-postgres-plocal psql -U mes_user -d mes360"

hr() { printf '%s\n' "--------------------------------------------------------------------------"; }

echo
hr; echo "1. WHAT THE SIMULATOR EMITTED"; hr
if [ ! -f "$TALLY" ]; then
  echo "  no tally at $TALLY -- is 03-simulator.sh running?"
  exit 1
fi
node -e "
  const t = require('$TALLY');
  console.log('  work order ' + (t.workOrder ?? '(all)') + '   ring=' + t.ring + '   speed=' + t.speed + 'x');
  console.log('  emitted between ' + t.startedAt + ' and ' + t.writtenAt);
  console.log();
  for (const r of t.rows.sort((a,b)=>a.machine.localeCompare(b.machine))) {
    console.log('    ' + r.machine.padEnd(6) + r.role.padEnd(7) + String(r.pulses).padStart(8) + ' pulses');
  }
"

echo
hr; echo "2. WHAT THE JOB ORDERS RECORDED"; hr
$PG -c "
SELECT m.code AS machine, j.\"operationName\" AS operation, j.status,
       j.\"actualQtyGood\" AS good, j.\"actualQtyRejected\" AS rejected, j.\"outputUnit\" AS unit
FROM job_orders j JOIN machines m ON m.id = j.\"machineId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
WHERE w.\"orderNumber\" = '$WO' ORDER BY j.\"sequenceOrder\";"

echo
hr; echo "3. THE TEST THAT MATTERS -- IS ANY MINUTE IMPOSSIBLE?"; hr
echo "   A minute above the machine's design rate is the 25 August jump returning."
echo "   Expect: (0 rows)"
$PG -c "
SELECT m.code AS machine, o.\"bucketStart\", o.\"goodParts\" AS counted,
       round((o.\"designSpeedPph\" / 60)::numeric, 1) AS ceiling_per_min,
       o.\"machineState\"
FROM oee_minutes o
JOIN machines m ON m.id = o.\"machineId\"
JOIN job_orders j ON j.id = o.\"jobOrderId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
WHERE w.\"orderNumber\" = '$WO'
  AND o.\"designSpeedPph\" > 0
  AND o.\"goodParts\" > (o.\"designSpeedPph\" / 60) * 1.5
ORDER BY o.\"goodParts\" DESC LIMIT 20;"

echo
hr; echo "4. THE MINUTE STORE AGAINST THE JOB ORDER"; hr
echo "   These two must agree, or the analytics screens and the shop floor disagree."
$PG -c "
SELECT m.code AS machine,
       j.\"actualQtyGood\" AS job_order,
       round(SUM(o.\"goodParts\")::numeric, 0) AS minute_store,
       count(o.id) AS minutes,
       round(MAX(o.\"goodParts\")::numeric, 0) AS biggest_minute
FROM job_orders j
JOIN machines m ON m.id = j.\"machineId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
LEFT JOIN oee_minutes o ON o.\"jobOrderId\" = j.id
WHERE w.\"orderNumber\" = '$WO'
GROUP BY m.code, j.\"actualQtyGood\", j.\"sequenceOrder\" ORDER BY j.\"sequenceOrder\";"

echo
hr; echo "5. THE GATEWAY'S OWN ACCUMULATORS"; hr
echo "   accumulated is what the edge counted. Compare it with section 1."
$PG -c "
SELECT m.code AS machine, t.name AS tag, t.\"counterRole\" AS role,
       g.accumulated, g.\"lastEdgeAt\"
FROM gateway_counter_states g
JOIN tag_definitions t ON t.id = g.\"tagId\"
LEFT JOIN machines m ON m.id = t.\"machineId\"
WHERE t.\"isActive\" AND t.\"counterRole\" <> 'NONE'
ORDER BY m.code, t.\"counterRole\";"

echo
hr; echo "6. IS ANYTHING HELD BACK RIGHT NOW?"; hr
echo "   accumulated must equal synced. A gap is a backlog waiting to flush as"
echo "   one delta -- exactly what produced the 25-26 August jump."
BUF="$HERE/../../apps/edgegateway/build/buffer/counter-state.json"
if [ -f "$BUF" ]; then
  node -e "
    const d = require('$BUF');
    let gap = 0;
    for (const [k, v] of Object.entries(d)) {
      const g = (v.accumulated ?? 0) - (v.synced ?? 0);
      if (g) { console.log('    BACKLOG ' + String(g).padStart(8) + '   tag ' + k.slice(0, 8)); gap++; }
    }
    console.log('    ' + Object.keys(d).length + ' tags, ' + gap + ' with a pending backlog');
    process.exitCode = 0;
  "
else
  echo "    no buffer file yet"
fi

echo
hr; echo "7. THE SIDE-BY-SIDE"; hr
echo "   Emitted vs counted, per machine. A gap of one or two is the ~2 second"
echo "   attribution window around a status change, not a defect. Tens are."
$PG -At -F'|' -c "
SELECT m.code, t.\"counterRole\", g.accumulated
FROM gateway_counter_states g
JOIN tag_definitions t ON t.id = g.\"tagId\"
JOIN machines m ON m.id = t.\"machineId\"
WHERE t.\"isActive\" AND t.\"counterRole\" IN ('GOOD','TOTAL');" > "$HERE/.counted.tmp"

node -e "
  const fs = require('fs');
  const t = require('$TALLY');
  const counted = new Map();
  for (const line of fs.readFileSync('$HERE/.counted.tmp', 'utf8').trim().split('\n')) {
    if (!line) continue;
    const [machine, role, acc] = line.split('|');
    counted.set(machine + '/' + role, Number(acc));
  }
  console.log();
  console.log('    ' + 'machine'.padEnd(9) + 'role'.padEnd(7) + 'emitted'.padStart(9) + 'counted'.padStart(9) + '   diff');
  let worst = 0;
  for (const r of t.rows.sort((a,b)=>a.machine.localeCompare(b.machine))) {
    const k = r.machine + '/' + r.role;
    const c = counted.has(k) ? counted.get(k) : null;
    const diff = c === null ? '-' : (c - r.pulses);
    if (c !== null) worst = Math.max(worst, Math.abs(c - r.pulses));
    console.log('    ' + r.machine.padEnd(9) + r.role.padEnd(7)
      + String(r.pulses).padStart(9) + String(c ?? '-').padStart(9) + '   ' + diff);
  }
  console.log();
  console.log(worst <= 3
    ? '    VERDICT: counted matches emitted within ' + worst + '. The counting path is sound.'
    : '    VERDICT: worst gap is ' + worst + '. Investigate before trusting these counts.');
" || true
rm -f "$HERE/.counted.tmp"

echo
hr
echo "Note: the gateway's accumulators reset to zero at every order handover, so"
echo "section 7 is only meaningful while ONE order has been running throughout."
hr
