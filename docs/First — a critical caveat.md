⚠️ First — a critical caveat about "rebuild from the beginning"
"Rebuild from the beginning" = re-clone from GitHub. But your latest fixes are only on your local Windows machine, not on GitHub — specifically:

the uploads-data volume + UPLOAD_DIR I just added to docker-compose.hostinger.yml / prod.yml
the recipe BOM list fix (recipe.service.ts)
A fresh git clone will not include these unless you push them first. So either push to GitHub before re-cloning, or you'll need to re-apply them on the server. Tell me if you want me to prep the push.

Teardown + rebuild on the VPS (run over SSH)

# ── 1. Tear down the MES360 stack + ALL its data volumes ──
cd /opt/mes360
docker compose -f docker-compose.hostinger.yml down -v --remove-orphans

# ── 2. Remove the MES360 images ──
docker rmi mes360-api:hostinger mes360-web:hostinger 2>/dev/null || true

# ── 3. Belt-and-suspenders: remove any leftover mes360 volumes ──
docker volume ls --format '{{.Name}}' | grep -i mes360 | xargs -r docker volume rm

# ── 4. Reclaim build-cache disk (safe: only dangling images + build cache) ──
docker image prune -f
docker builder prune -af

# ── 5. Delete the project folder ──
cd /opt
rm -rf /opt/mes360

# ── 6. Re-clone + rebuild from scratch ──
git clone https://github.com/ahmedalghammouri/MES360_SDPF.git mes360
cd mes360
cp .env.hostinger.example .env.hostinger
nano .env.hostinger          # ⬅ fill REAL secrets (APP_DOMAIN, POSTGRES_PASSWORD,
                             #    MINIO_ROOT_PASSWORD, INFLUX_PASSWORD, INFLUX_TOKEN,
                             #    JWT_SECRET, JWT_REFRESH_SECRET, REDIS_PASSWORD …)

# IMPORTANT: load the env file (compose only auto-reads ".env")
docker compose --env-file .env.hostinger -f docker-compose.hostinger.yml up -d --build
Notes
Step 1 (down -v) is the real data wipe — DB, timeseries, MinIO, uploads all gone. Skip -v if you wanted to keep data (you don't, per your request).
Don't run docker system prune -af --volumes (whole-host nuke) if anything else runs on this VPS (e.g. Traefik) — the scoped commands above only touch MES360.
The env file is mandatory — last deploy every secret defaulted to blank, which would break Postgres/auth. Fill real values and use --env-file .env.hostinger (or cp .env.hostinger .env).
After it's up, the fresh uploads-data volume is created writable by the nestjs user (Dockerfile fix), so attachment uploads work and persist — provided the hostinger compose you cloned actually contains the uploads-volume change (see the caveat above).
Want me to (a) prepare the GitHub push of the local fixes so the fresh clone is complete, or (b) give you the exact lines to paste into the server's compose after cloning if you'd rather not push?


cp .env.hostinger .env  &&  docker compose -f docker-compose.hostinger.yml up -d --build