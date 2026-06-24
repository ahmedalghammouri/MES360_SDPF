1. One-time prerequisites (first deploy only)

# a) Deploy the Traefik template once in Docker Manager, then confirm its network name:
docker network ls | grep -i traefik
#    If it's NOT "traefik-proxy", note it — the hostinger file uses an internal
#    bridge "mes-network" and Traefik reaches it via the Docker provider, so usually
#    nothing to change. Only edit if your Traefik setup differs.

# b) Point DNS:  A record  APP_DOMAIN  ->  your VPS IP   (do this in your DNS panel)

# c) Create the env file from the template and fill in real secrets:
cp .env.hostinger.example .env.hostinger
nano .env.hostinger        # set APP_DOMAIN + all passwords/tokens/JWT secrets

Required values in .env.hostinger: APP_DOMAIN, POSTGRES_PASSWORD, REDIS_PASSWORD, INFLUX_PASSWORD, INFLUX_TOKEN, MINIO_ROOT_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, GRAFANA_ADMIN_PASSWORD (the rest have safe defaults).

2. Build + deploy

docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d --build

This builds the api and web images on the VPS, starts Postgres/Redis/Influx/MQTT/MinIO/Grafana, then runs migrate-seed (schema push + seed + Dashboard-Center seed + 90-day snapshot backfill) before api starts. The finished-goods backfill runs automatically on API boot.

3. Verify

docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger ps          # all "Up/healthy"
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger logs -f migrate-seed   # confirm "Dashboard Center seed" + "ProductionSnapshot backfill"
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger logs -f api             # confirm "Finished-goods backfill" + listening on 3001

Then open https://APP_DOMAIN (app), https://APP_DOMAIN/api/v1/health, and https://APP_DOMAIN/grafana.

Redeploy after code changes (every subsequent update)

git pull                                                                              # pull latest code
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d --build --force-recreate api web

migrate-seed re-runs idempotently (safe). Grafana dashboards are mounted read-only and hot-reload — no rebuild needed for dashboard-only changes.

Tip: to avoid typing --env-file each time, you can rename .env.hostinger → .env (Compose auto-loads .env), then just docker compose -f 

docker-compose.hostinger.yml up -d --build.

One caveat worth knowing: the first build compiles both images on the VPS and pulls the Grafana plugins — budget a few minutes and make sure the VPS has enough RAM/disk (the api is capped at 768 MB; a 2 GB+ VPS is comfortable).

Want me to add a small deploy.sh helper script to the repo that wraps these steps (build, health-wait, log tail)?