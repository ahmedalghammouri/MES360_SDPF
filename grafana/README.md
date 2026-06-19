# MES360° — Grafana Industrial Dashboard Suite

Production-ready, **fully provisioned** Grafana dashboard library for MES360°.
Everything in this folder is loaded automatically on `docker compose up -d` — no
manual dashboard creation, no clicking around the Grafana UI.

```
grafana/
├── provisioning/
│   ├── datasources/   datasources.yaml         (Postgres / InfluxDB / Prometheus)
│   ├── dashboards/    dashboards.yaml          (one provider per Grafana folder)
│   └── alerting/      contact-points / policies / alert-rules
├── dashboards/        65 dashboard JSON files across 10 folders
│   ├── production/    manufacturing/  maintenance/  quality/  inventory/
│   ├── energy/        traceability/   iiot/         executive/  templates/
├── generate.mjs       dashboard generator (source of truth → emits dashboards/*)
└── README.md
```

## Quick start

```bash
docker compose up -d grafana          # uses the existing mes-grafana container
open http://localhost:3003            # admin / mes360
```

On boot Grafana will contain **all folders, all dashboards, all variables, all
alerts** — and the MES360° **Dashboard Center** discovers them automatically.

## Regenerating dashboards

Dashboards are generated from [`generate.mjs`](generate.mjs) so 65 dashboards stay
consistent (same factory-context variables, datasource UIDs, panel styling):

```bash
node grafana/generate.mjs            # rewrites grafana/dashboards/**/*.json
```

Both the generator **and** its JSON output are committed to source control. Edit the
generator (not the JSON) to change panels in bulk; provisioning reloads from disk
every 10s, so changes appear without restarting Grafana.

## Documentation

| Doc | Contents |
|---|---|
| [GRAFANA_DASHBOARD_LIBRARY](../docs/GRAFANA_DASHBOARD_LIBRARY.md) | Every dashboard, its panels and KPIs |
| [GRAFANA_PROVISIONING](../docs/GRAFANA_PROVISIONING.md) | How auto-provisioning works + deployment |
| [GRAFANA_ALERTING](../docs/GRAFANA_ALERTING.md) | The 7 operational alerts and routing |
| [GRAFANA_FACTORY_CONTEXT](../docs/GRAFANA_FACTORY_CONTEXT.md) | Global variables ↔ MES360° factory context |

## Relationship to the Dashboard Center

This phase builds **only the Grafana dashboards**. The Dashboard Center (Phase 1) is
untouched. Register these dashboards in the catalog by setting their `grafanaUid` (the
file name, e.g. `mes-prod-overview`) — or import via `GET /dashboards/grafana/available`.
The embed layer injects `var-factory/area/line/machine/shift/product/batch` automatically.
