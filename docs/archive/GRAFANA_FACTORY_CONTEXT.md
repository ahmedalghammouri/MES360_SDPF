# MES360° — Grafana Factory Context

How every dashboard inherits the **MES360° factory / ISA-95 context** so that opening a
dashboard from the Dashboard Center automatically scopes it to the selected factory.

---

## 1. Standard template variables

Every dashboard is generated with the same eight scoping controls (see
[`generate.mjs → standardVars()`](../grafana/generate.mjs)):

| Variable | Grafana name | Value | Source query (Postgres) |
|---|---|---|---|
| Factory | `factory` | factory **code** | `factories.code` (active) |
| Area | `area` | area **id** | `areas` for `$factory` |
| Production Line | `line` | line **id** | `production_lines` for `$factory` |
| Machine | `machine` | machine **id** | `machines` for `$factory` |
| Shift | `shift` | shift template **id** | `shift_templates` for `$factory` |
| Product | `product` | SKU **id** | `skus` for `$factory` |
| Batch | `batch` | batch **id** | `batch_records` for `$factory` |
| DateRange | *(native)* | time range | Grafana time picker (`$__timeFilter`) |

All variables are **chained** off `$factory` (selecting a factory filters the rest) and
support **All** (`allValue = ''`), so a panel SQL filter reads:

```sql
JOIN factories f ON f.id = t."factoryId"
WHERE $__timeFilter(t."recordDate")
  AND ('$factory' = '' OR f.code = '$factory')   -- factory scope (All = no filter)
  AND ('$machine' = '' OR t."machineId" = '$machine')
```

`DateRange` is the native Grafana time range — the embed layer passes `from`/`to` to it, so
no separate variable is needed.

## 2. The embed contract (Dashboard Center → Grafana)

When a user opens a Grafana dashboard from the MES360° **Dashboard Center**, the embed URL
builder (`GrafanaService.buildEmbedUrl`, Phase 1) injects the current context as Grafana
variables:

```
/d/<uid>/<slug>?kiosk
   &var-factory=<factoryCode>     &var-factoryId=<factoryId>
   &var-area=<areaId>             &var-line=<lineId>
   &var-machine=<machineId>       &var-shift=<shiftId>
   &var-product=<skuId>           &var-batch=<batchId>
   &from=<range>&to=now&theme=<light|dark>&refresh=<interval>
```

The variable **names and value types match exactly**:

- `var-factory` carries the factory **code** → variable `factory` (value = code). ✔
- `var-area/line/machine/shift/product/batch` carry **ids** → matching id-valued variables. ✔

Only scopes listed in the dashboard's `supportedScopes` are injected, and only when the
catalog entry is `isFactoryAware` (default true).

## 3. End-to-end flow

```
MES360° factory selector (useFactoryStore)
        │  selected factory id
        ▼
GET /dashboards/:id/embed?factoryId=…           (resolves factory code, ISA-95 scope)
        │  kiosk embed URL with var-* params
        ▼
Embedded viewer <iframe src=…>  →  Grafana applies var-factory etc.
        │
        ▼
Dashboard panels filter by ('$factory' = '' OR f.code = '$factory') …
```

The user never picks a factory inside Grafana — it is inherited from MES360°. They can
still refine Area/Line/Machine/etc. via the dashboard's variable dropdowns.

## 4. Adding a new factory-aware dashboard

1. Add a dashboard definition in `generate.mjs` (reuse `standardVars()` — it's automatic in
   `mkDash`). Filter panel SQL with the `('$factory' = '' OR f.code = '$factory')` pattern.
2. `node grafana/generate.mjs` → commit the new JSON.
3. Register it in the Dashboard Center: `POST /dashboards` with `source: GRAFANA`,
   `grafanaUid: <file-name>`, and `supportedScopes` (e.g. `["FACTORY","LINE","MACHINE"]`).
   Or import via `GET /dashboards/grafana/available`.

## 5. Telemetry datasources and factory context

For InfluxDB/Prometheus panels, carry factory context as a **tag** on the series and filter
with the variable, e.g. Flux:

```flux
from(bucket: "mes_timeseries")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.factory == "${factory}" or "${factory}" == "")
```

or PromQL: `rate(metric{factory="$factory"}[5m])`. Ensure the telemetry pipeline stamps a
`factory` (code) tag so the same variable scopes relational and time-series panels alike.
