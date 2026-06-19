# MES360° — Grafana Provisioning

How the dashboard suite is **automatically** loaded so that, after
`docker compose up -d`, Grafana contains all folders, dashboards, variables, datasources
and alerts with **zero manual configuration**.

---

## 1. Components

```
grafana/provisioning/
├── datasources/datasources.yaml     # Postgres / InfluxDB / Prometheus (stable UIDs)
├── dashboards/dashboards.yaml        # one file provider per Grafana folder
└── alerting/
    ├── contact-points.yaml           # MES360° webhook + email
    ├── notification-policies.yaml    # routing tree
    └── alert-rules.yaml              # 7 operational alert rules
grafana/dashboards/<category>/*.json  # 65 dashboard definitions
```

The existing `mes-grafana` container is reused — **no new Grafana service**.

## 2. docker-compose wiring

The `grafana` service in [`docker-compose.yml`](../docker-compose.yml) mounts:

| Host path | Container path | Purpose |
|---|---|---|
| `./grafana/provisioning` | `/etc/grafana/provisioning` | datasources, providers, alerting |
| `./grafana/dashboards` (ro) | `/var/lib/grafana/dashboards` | dashboard JSON library |
| `grafana-data` (named vol) | `/var/lib/grafana` | alert state / annotations |

Key environment:

```yaml
GF_SECURITY_ALLOW_EMBEDDING: "true"      # Dashboard Center iframe embedding
GF_PLUGINS_PREINSTALL: "redis-datasource,marcusolsson-treemap-panel"  # (replaces deprecated GF_INSTALL_PLUGINS)
MES_PG_HOST/PORT/DB/USER/PASSWORD: …     # consumed by datasources.yaml
MES_INFLUX_URL/ORG/BUCKET/TOKEN: …
MES_PROM_URL: http://prometheus:9090
```

`depends_on: [prometheus, postgres, influxdb]` ensures datasources are reachable at boot.

## 3. Datasources

Provisioned with **stable UIDs** that every dashboard panel references — they must not
change:

| Name | UID | Type |
|---|---|---|
| MES360° PostgreSQL | `mes_postgres` | postgres (default) |
| MES360° InfluxDB | `mes_influxdb` | influxdb (Flux) |
| MES360° Prometheus | `mes_prometheus` | prometheus |

Connection values come from the `MES_*` env vars (with safe in-file defaults), so the same
provisioning file works in dev, staging and prod by overriding env only.

## 4. Dashboard providers → Grafana folders

`dashboards.yaml` declares **one provider per category** so each maps to a clean Title-case
Grafana folder while the source tree stays lowercase:

```
production/    → Production         maintenance/  → Maintenance
manufacturing/ → Manufacturing      quality/      → Quality
inventory/     → Inventory          energy/       → Energy
traceability/  → Traceability       iiot/         → IIoT
executive/     → Executive          templates/    → Templates
```

Providers reload from disk every **10 s** (`updateIntervalSeconds: 10`), so edits appear
without a Grafana restart. `allowUiUpdates: false` keeps the files in source control as the
source of truth.

## 5. Surviving container recreation

Dashboards live in the **read-only mounted source tree**, not inside the container — so
`docker compose down && up` re-provisions them identically. The `grafana-data` named volume
additionally persists alert history and annotations across recreations.

## 6. Generating / editing dashboards

The 65 JSON files are emitted by [`grafana/generate.mjs`](../grafana/generate.mjs):

```bash
node grafana/generate.mjs        # rewrites grafana/dashboards/**/*.json
```

Edit the generator (shared panel builders + per-dashboard definitions) rather than
hand-editing JSON, then commit both. This guarantees consistent variables, datasource UIDs
and styling across the whole suite.

## 7. Verification checklist

```bash
docker compose up -d grafana
docker logs mes-grafana | grep -i "finished to provision"   # providers loaded
curl -s -u admin:mes360 http://localhost:3003/api/search?type=dash-db | jq length   # = 65
curl -s -u admin:mes360 http://localhost:3003/api/folders | jq '.[].title'          # 10 folders
curl -s -u admin:mes360 http://localhost:3003/api/datasources | jq '.[].uid'        # mes_postgres,…
```

Then open the MES360° **Dashboard Center** → it discovers all Grafana dashboards via
`GET /dashboards/grafana/available`.

## 8. Production overrides

In production, override via environment (compose `env_file` or orchestrator secrets):

```env
MES_PG_HOST=prod-postgres
MES_PG_PASSWORD=__secret__
MES_INFLUX_URL=https://influx.internal:8086
MES_INFLUX_TOKEN=__secret__
GF_SECURITY_ADMIN_PASSWORD=__secret__
```

No dashboard JSON or provisioning file needs editing between environments.
