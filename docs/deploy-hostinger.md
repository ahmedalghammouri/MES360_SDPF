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
