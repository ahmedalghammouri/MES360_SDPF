# Hostinger deploy — 30 Aug 2026

Everything below is run from `/opt/mes360` on the VPS, as root.

The stack builds the api and the web **on the box** from source, so a code
change is a rebuild, not a pull of an image. Two of the changes in this batch
are code (a rebuild is required) and two are data (SQL only).

---

## What is in this batch

| Commit | What it changes | Needs |
|---|---|---|
| `85802d5` | Login/selector KPIs read the real OEE engine instead of a dead table | api **and** web rebuild |
| `5a93442` | Facility coordinates as SQL, because ts-node OOMs on this box | SQL only |
| `8a33bbd` | The six no-production windows become IDLE and leave the calculations | SQL only |
| `da625fb`, `f2ba767` | Dashboard figures and the analytics filter bar | web rebuild |

---

## 0 · Back up first

The two SQL scripts delete rows. Take the dump before anything else — it is
the only thing that makes the rest reversible.

```bash
cd /opt/mes360
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres pg_dump -U mes_user -d mes360 \
  | gzip > ~/mes360-before-$(date +%Y%m%d-%H%M).sql.gz

ls -lh ~/mes360-before-*.sql.gz     # confirm it is not empty
```

A dump that is a few kilobytes means it failed. Check it before continuing.

---

## 1 · Code

```bash
cd /opt/mes360
git status --short          # must be clean; local edits will block the pull
git pull
git log --oneline -1        # expect 85802d5
```

Build one service at a time. The Next.js build is the memory-hungry one, and
this box has already killed a Node process at ~384 MB.

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger build api
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger build web
```

If the web build dies with "JavaScript heap out of memory", give it a bigger
heap and retry that one command:

```bash
NODE_OPTIONS=--max-old-space-size=3072 \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger build web
```

Bring them up:

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d api web
```

**Confirm the containers are on the images you just built.** A build that
succeeds while the old container keeps running has happened three times on this
project; the digests are the only proof.

```bash
for s in api web; do
  echo "$s image:     $(docker image inspect mes360-$s:hostinger --format '{{.Id}}')"
  echo "$s container: $(docker inspect mes-$s-prod --format '{{.Image}}')"
done
```

The two lines of each pair must match.

---

## 2 · Facility coordinates

Preview prints how far each pin moves and changes nothing:

```bash
cd /opt/mes360
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 \
  < apps/api/prisma/sql/factory-coordinates.sql
```

Expect SDPF 37.2 km, SAF 36.5 km, SIDCO 3.1 km, and **RNTIC and NDPF swapping
region by ~1,220 km each** — Jeddah↔Dammam. That swap is what the client's
links say; confirm it verbally before applying.

```bash
{ cat apps/api/prisma/sql/factory-coordinates.sql; echo "COMMIT;"; } | \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 -v apply=1
```

Idempotent: a repeat run reports 0 m moved.

---

## 3 · The no-production windows

Preview first. **Read section 3 of its output** — there is production recorded
inside every window, and that is what gets removed.

```bash
cd /opt/mes360
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 \
  < apps/api/prisma/sql/idle-windows.sql
```

Then apply:

```bash
{ cat apps/api/prisma/sql/idle-windows.sql; echo "COMMIT;"; } | \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 -v apply=1
```

### If it fails with `canceling statement due to lock timeout`

The api writes `oee_minutes` every minute, so the delete can find the table
busy. The script sets `lock_timeout = '10s'` deliberately — it gives up rather
than blocking the plant. Stop the api for the thirty seconds it needs:

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger stop api
# ...re-run the apply command above...
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger start api
```

The edge gateway keeps counting into the database throughout; only the
minute-writer pauses.

### To repair only the states and leave the output totals alone

```bash
... | psql ... -v apply=1 -v keep_orders=1
```

---

## 4 · Verify

```bash
# The endpoint the login page and the factory map both read
curl -s https://$APP_DOMAIN/api/v1/auth/factories/overview | head -c 400; echo
```

Expect `"windowDays":30`, real numbers on SDPF, and `null` on the other four
sites. **Four em-dashes on the login page is correct**, not a new fault: those
factories have no machines reporting into this database, so they have no OEE.

```bash
# Nothing left inside the windows, on any of the four machines
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 -c \
"WITH w(f,t) AS (VALUES
  (timestamp '2026-08-23 15:48', timestamp '2026-08-23 16:55'),
  (timestamp '2026-08-24 00:11', timestamp '2026-08-24 05:28'),
  (timestamp '2026-08-24 07:20', timestamp '2026-08-24 13:20'),
  (timestamp '2026-08-25 10:50', timestamp '2026-08-26 06:00'),
  (timestamp '2026-08-26 14:00', timestamp '2026-08-27 10:00'))
SELECT m.code,
       count(*) FILTER (WHERE r.state <> 'IDLE') AS non_idle_bands,
       (SELECT count(*) FROM oee_minutes o JOIN w ON o.\"bucketStart\">=w.f
         AND o.\"bucketStart\"<w.t WHERE o.\"machineId\"=m.id) AS minutes_left
  FROM machine_state_records r JOIN machines m ON m.id=r.\"machineId\"
  JOIN w ON r.\"startTime\" < w.t
        AND COALESCE(r.\"endTime\", timestamp '9999-12-31') > w.f
 WHERE m.code IN ('M1','M2','M3','M4') GROUP BY m.id, m.code ORDER BY m.code;"
```

Want zeros in both columns on all four rows.

Then in the browser: the login tiles read `Overall OEE · 30d` with a real
percentage for SDPF, and the five map pins sit on the new locations.

---

## Rollback

```bash
gunzip -c ~/mes360-before-<stamp>.sql.gz | \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360
```

For the code, `git checkout <previous sha>` and rebuild the same two services.

---

## Still pending — NOT in this batch

Each of these is a separate data decision and none is included above. Listed
so they are not lost:

- `delete-dead-tags.sql` — 9 unused tags still present
- `close-forgotten-job-orders.sql` — the 28 Aug 06:46 cut
- `rescale-double-counted-order.sql` — WO-2026-0005 to 9,672 / 31 pallets
- `match-minutes-to-shopfloor.sql` — minute store vs job orders
- `wipe-work-order.sh` — delete WO-2026-0005 entirely
- Install the rebuilt `edgegateway.exe` on the plant PC (built 26 Aug 10:07)
- The field question on `EDGE_COUNTER_M03` address 2: does the wrapper have
  its own sensor wired, or do M3 and M4 genuinely share one signal?

---
---

# Batch 2 — 31 Aug 2026, before the morning run

**Two destinations, and they are not the same machine.** Nothing in this batch
touches the api or the web: `git diff --stat cccf8dd..HEAD` is five files, all
of them either edge-gateway source or SQL. So **Hostinger needs no rebuild** —
only a pull and two scripts. The part that matters for the morning run goes to
the **plant PC**, as an exe.

| Commit | Where it goes |
|---|---|
| `6b1e1e8` counting governor + run gate | plant PC (exe) |
| `6810881` limits screen shows the real cap | plant PC (exe) |
| `56b81c1` line balancer in detect-only | Hostinger (SQL) |
| dead-tag criteria (d) | Hostinger (SQL) |

---

## 0 · Push, from this machine

The three commits are local only — `origin/ASSA_POC_SDPF` is still at
`85802d5`. Without this, the pull on Hostinger gets nothing.

```bash
cd "d:/NEW WORKS/New folder/MES360_SDPF"
git push
git ls-remote origin ASSA_POC_SDPF     # expect 56b81c1
```

---

## A · Plant PC — the edge gateway

This is the one that decides whether tomorrow's counts are sane. Do it first.

The build is at `apps/edgegateway/build/edgegateway.exe`, built 05:12 on
31 Aug. Verified to contain `WINDOW_MINUTES`, `stoppedWhileIdleCounts`,
`capSource` and `droppedWhileStopped`.

Copy that one file to the gateway folder on the plant PC. Everything else in
the folder — `gateway-config.json`, `buffer\`, `logs\`, `nssm-2.24\` — stays
exactly as it is.

From an Administrator prompt, in the gateway folder:

```bat
nssm stop Mes360EdgeGateway

REM Keep the running build. The naming convention is already in this folder
REM (edgegateway.exe.bak-2026-08-19) and it is the whole of the rollback.
copy edgegateway.exe edgegateway.exe.bak-2026-08-31

REM ...now copy the new edgegateway.exe over the old one...

nssm start Mes360EdgeGateway
nssm status Mes360EdgeGateway
```

**Do not create a `machineLimits` block.** The cap is on by default now — that
is the point of `6b1e1e8`. Configure one only to make a machine TIGHTER than
design speed + 25%.

### Rollback, if the counts look wrong in the first ten minutes

```bat
nssm stop Mes360EdgeGateway
copy edgegateway.exe.bak-2026-08-31 edgegateway.exe
nssm start Mes360EdgeGateway
```

The run gate is the change to watch. It DROPS pulses seen while the machine is
not running, and it takes `running` from the state engine. If the state engine
were wrong about a machine, real counts would be lost rather than delayed —
which is why `droppedWhileStopped` exists and why it is the first number to
read in the morning.

---

## B · Hostinger — two scripts, no rebuild

```bash
cd /opt/mes360
git pull
git log --oneline -1        # expect 56b81c1

# The dump first. Both scripts change rows.
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres pg_dump -U mes_user -d mes360 \
  | gzip > ~/mes360-before-$(date +%Y%m%d-%H%M).sql.gz
ls -lh ~/mes360-before-*.sql.gz
```

### B1 · Dead tags

```bash
# preview
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 \
  < apps/api/prisma/sql/delete-dead-tags.sql

# apply
{ cat apps/api/prisma/sql/delete-dead-tags.sql; echo "COMMIT;"; } | \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360
```

Expect **13 rows**, every one with `alarms_blocking = 0`. If any row shows a
non-zero alarm count, stop — that tag is wired to an alarm definition and the
delete would take the alarm with it.

### B2 · The line balancer, detect-only

```bash
# preview
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 \
  < apps/api/prisma/sql/line-balance-detect-only.sql

# apply
{ cat apps/api/prisma/sql/line-balance-detect-only.sql; echo "COMMIT;"; } | \
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger \
  exec -T postgres psql -U mes_user -d mes360 -v apply=1
```

The last check must print **0 rows**: nothing may have `applyAdjustment` set.
Takes effect on the balancer's next tick — no gateway restart.

Off again, if it is noisy:

```bash
{ cat apps/api/prisma/sql/line-balance-detect-only.sql; echo "COMMIT;"; } | \
docker compose ... psql -U mes_user -d mes360 -v apply=1 -v off=1
```

---

## C · Is batch 1 actually on the box?

The database was repaired by hand, but the api and web of `85802d5` may not
have been rebuilt. One command tells you:

Do NOT reach for `curl https://$APP_DOMAIN/...` here. `APP_DOMAIN` lives in
`.env.hostinger`, which docker compose reads and the login shell does not, so
the variable is empty and the request goes to `https:///api/v1/...`. With
`-s` that fails silently and prints nothing — which is indistinguishable from
"batch 1 is not deployed", and is the wrong answer to act on.

Ask the container what code it is running instead. No DNS, no TLS, no
environment:

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger   exec -T api sh -c "grep -rl windowDays dist 2>/dev/null | head -3"
```

Prints a path → batch 1 is deployed. Prints nothing → it is not, and section 1
of the batch-1 runbook above (build api, build web, up -d, compare digests)
still has to run.

If you do want it over HTTP, source the file first:

```bash
set -a; . ./.env.hostinger; set +a
curl -s "https://$APP_DOMAIN/api/v1/auth/factories/overview" | head -c 200; echo
```

---

## D · What to read in the morning

On the gateway's local screens:

- **`machine-limits`** — `capSource` should read `default` on all four
  machines. `trimmedGood` climbing on M1/M2 is the burst cap doing its job;
  climbing hard on M3/M4 is the sustained-rate cap doing its job.
- **`droppedWhileStopped`** — should stay at or near zero. A number that climbs
  is an input turning while its machine stands still, and no cap or debounce
  explains that. Report it rather than tuning around it.
- **The balancer** — expect every step **CLAMPED**. The ceiling is 10% and the
  real gaps are several hundred per cent. Clamped is the design working: the
  worse a counter gets, the louder it becomes.

### The one number that is still not defended

The line's headline output comes from M4, the final step, and M4 counted 6.5x
the plant's own figure on WO-2026-0005. The cap sits 16x above M4's real rate,
so it will not touch that.

M3 and M4 both read **address 2 on EDGE_COUNTER_M03**, on opposite edges — one
physical input serving both the wrapper and the palletiser, and the balancer's
configured anchor is M3. Until there is a field answer on whether the wrapper
has its own sensor wired, that number is reported, not repaired.
