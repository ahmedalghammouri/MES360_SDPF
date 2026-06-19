# MES360° — Grafana Alerting

Seven provisioned operational alert rules, evaluated by the existing `mes-grafana`
instance and routed back into MES360°. Everything is loaded from
[`grafana/provisioning/alerting/`](../grafana/provisioning/alerting) on boot.

---

## 1. Alert rules

Group **`MES Operational Alerts`** (folder `Alerts`), evaluated every **1 min**. Each rule
runs a PostgreSQL metric query (`A`), reduces to the last value (`B`), and applies a
threshold (`C`).

| Alert | UID | Condition | Severity | `for` |
|---|---|---|---|---|
| **Low OEE** | `mes_alert_low_oee` | avg OEE (1h) `< 60%` | warning | 10m |
| **High Downtime** | `mes_alert_high_downtime` | OEE-impacting downtime (1h) `> 60 min` | warning | 5m |
| **Machine Offline** | `mes_alert_machine_offline` | active devices not `ONLINE` `> 0` | critical | 5m |
| **Quality Failures** | `mes_alert_quality_failures` | open `CRITICAL` NCRs (1h) `> 0` | critical | 5m |
| **Energy Overconsumption** | `mes_alert_energy_overconsumption` | avg power (15m) `> 500 kW` | warning | 10m |
| **Inventory Below Safety Stock** | `mes_alert_inventory_safety_stock` | RM/spares under min `> 0` | warning | 15m |
| **Critical Maintenance Overdue** | `mes_alert_maintenance_overdue` | overdue `CRITICAL` maint WOs `> 0` | critical | 5m |

> Thresholds are conservative defaults. Tune them by editing
> [`alert-rules.yaml`](../grafana/provisioning/alerting/alert-rules.yaml) (the `conditions →
> evaluator → params` value) and restarting Grafana, or override per-plant.

### Example rule shape

```yaml
- uid: mes_alert_low_oee
  title: Low OEE
  condition: C
  for: 10m
  labels: { severity: warning, domain: production }
  data:
    - refId: A           # Postgres metric
      datasourceUid: mes_postgres
      model: { rawSql: "SELECT COALESCE(AVG(oee),100) AS value FROM oee_records WHERE \"recordDate\" > NOW() - INTERVAL '1 hour';", format: table }
    - refId: B           # reduce(last)
      datasourceUid: __expr__
      model: { type: reduce, reducer: last, expression: A }
    - refId: C           # threshold
      datasourceUid: __expr__
      model: { type: threshold, expression: B, conditions: [{ evaluator: { type: lt, params: [60] } }] }
```

## 2. Contact points

[`contact-points.yaml`](../grafana/provisioning/alerting/contact-points.yaml):

- **MES360° Notifications** — webhook to `MES_ALERT_WEBHOOK`
  (default `http://api:4001/api/v1/notifications/grafana-webhook`), so MES alerts surface in
  the platform notification feed.
- **Plant Email** — email to `MES_ALERT_EMAIL` for critical escalation.

> The webhook target is a suggested integration endpoint. If the MES360° API does not yet
> expose `grafana-webhook`, alerts still fire and are visible in Grafana; wire the endpoint
> (or point the webhook at any receiver) to push them into the MES feed. **No existing API
> was modified in this phase.**

## 3. Notification policy

[`notification-policies.yaml`](../grafana/provisioning/alerting/notification-policies.yaml):
default receiver is **MES360° Notifications**, grouped by `alertname, factory, machine`.
A child route sends `severity = critical` additionally to **Plant Email** with a faster
repeat interval.

## 4. Configuration

```env
MES_ALERT_WEBHOOK=http://api:4001/api/v1/notifications/grafana-webhook
MES_ALERT_EMAIL=ops@mes360.sa
```

For email delivery, configure Grafana SMTP (`GF_SMTP_ENABLED`, `GF_SMTP_HOST`, …) on the
`grafana` service.

## 5. Verification

```bash
curl -s -u admin:mes360 http://localhost:3003/api/v1/provisioning/alert-rules | jq length   # 7
curl -s -u admin:mes360 http://localhost:3003/api/v1/provisioning/contact-points | jq '.[].name'
```

Or in the UI: **Alerting → Alert rules** → group *MES Operational Alerts*.
