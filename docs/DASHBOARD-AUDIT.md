# MES360° — Dashboard Data & Logic Audit

A review of the platform's dashboards/analytics screens: their data sources, the
API behind each metric, how the numbers are calculated, and whether the figures
are **consistent and logical across screens**. It also documents the new in-page
explainer (the **ℹ️ info icon**) added to each dashboard.

> Scope of this pass: the primary operational dashboards. Section 5 lists the
> remaining analytics screens and how to extend the same explainer + checks to them.

---

## 1. The in-page explainer (ℹ️ icon)

Every reviewed dashboard now has an **info icon in its header**. Clicking it opens
a bilingual (EN/AR, RTL-aware) modal that explains, for that page:

- **What the page shows** (overview).
- **Every metric + its formula** (language-neutral formula shown verbatim).
- **The benchmark / how to read it** (world-class targets).
- **Data sources** (the exact API endpoint + the source-of-truth tables).
- **How to use it** (the action the metric should drive).
- **Consistency notes** (how the number reconciles with other screens).

**Implementation**
- Component: [`apps/web/src/components/ui/dashboard-info.tsx`](../apps/web/src/components/ui/dashboard-info.tsx) — `<DashboardInfo id="…" />`.
- Content: [`apps/web/src/lib/dashboard-explainers.ts`](../apps/web/src/lib/dashboard-explainers.ts) — one `Explainer` per page, fully bilingual. No i18n-JSON pollution; content is co-located and easy to extend.

Wired into: Production Overview, OEE, Production KPIs, Downtime, Maintenance
Overview, Quality Overview, Inventory Overview, Energy Overview, Factory
(Home) Dashboard, Traceability.

---

## 2. Calculation reference (single source of truth)

These are the canonical formulas the platform uses. The explainers and every
dashboard reference **these same definitions** so screens reconcile.

| Metric | Formula | Notes |
|---|---|---|
| **OEE** | `Availability × Performance × Quality` | Multiplicative — one weak factor pulls it down. |
| **Availability** | `Run Time ÷ Planned Production Time` | Lost to breakdowns + setups + unplanned stops. |
| **Performance** | `(Ideal Cycle × Total Count) ÷ Run Time` | Lost to minor stops + speed loss. |
| **Quality (OEE)** | `Good Count ÷ Total Count` | Good vs **produced**. |
| **MTBF** | `Operating Time ÷ Number of Failures` | Higher = more reliable. |
| **MTTR** | `Total Repair Time ÷ Number of Repairs` | Lower = faster recovery. |
| **Asset Availability** | `MTBF ÷ (MTBF + MTTR)` | Reliability-based availability. |
| **PM Compliance** | `PMs done on-time ÷ PMs scheduled` | Discipline indicator. |
| **FPY** | `Units passing first time ÷ Units inspected` | First-time-pass at **inspection** (≠ OEE-Quality). |
| **Available stock** | `Current Stock − Reserved Stock` | What the material-shortage gate checks. |
| **Energy intensity** | `Energy ÷ Units Produced` | Normalises consumption to output. |

**World-class benchmarks**: OEE 85% · Availability 90% · Performance 95% ·
Quality 99% · Asset Availability 90% · PM Compliance 90% · FPY 99%.

---

## 3. Per-dashboard data-source map

| Dashboard | Primary API(s) | Source of truth | Scope-aware | Verdict |
|---|---|---|---|---|
| Production Overview | `GET /production/kpis`, `GET /production/work-orders` | OEERecord rollup (JO→WO→PO), WorkOrder | ✅ area/line/machine | Consistent |
| OEE Analysis | `GET /production/oee/calculate` | OEERecord (per-machine) + engine rollup | ✅ + timeframe | Consistent |
| Production KPIs | `GET /production/kpis`, `/production/oee/calculate` | same engine as Overview | ✅ | Consistent |
| Downtime | `GET /production/downtime` | DowntimeEvent (cause, duration, machine) | ✅ + time range | Consistent (Pareto scoped) |
| Maintenance Overview | `GET /maintenance/kpis`, `/maintenance/work-orders` | MaintenanceWO + DowntimeEvent | ✅ | Consistent |
| Quality Overview | `GET /quality/kpis` | InspectionResult, NCR, CAPA | ✅ | Consistent |
| Inventory Overview | `GET /inventory/overview` | RawMaterial / SparePart / MaterialLot / SKU | ✅ | Consistent |
| Energy Overview | `GET /energy/overview`, `/energy/consumption` | EnergySummary + InfluxDB series | ✅ + time range | Consistent |
| Factory (Home) | aggregates the module KPI endpoints | same engines | ✅ | Consistent |
| Traceability | `GET /production/traceability/backward\|forward`, `/traceability` | MaterialConsumption + TraceabilityLink + TraceEvent | n/a (lot-scoped) | Consistent |

---

## 4. Consistency findings

**Confirmed consistent**
1. **OEE is one number everywhere.** Production Overview, OEE Analysis, Production
   KPIs and the Home dashboard all read the same OEE engine (OEERecord rolled
   JO→WO→PO). They cannot disagree by construction.
2. **MTTR/MTBF** on the Maintenance Overview use the same definitions as the
   reliability trend chart — reconcilable.
3. **Inventory availability** everywhere is `current − reserved`, which is exactly
   what the production material-shortage gate evaluates — so a WO blocked for a
   shortage matches what Inventory shows as low/available.

**Clarified (not a bug, a known subtlety — now documented in the explainers)**
4. **OEE-Quality vs FPY** measure related-but-different things:
   - OEE-Quality = `good ÷ total produced` (production yield).
   - FPY = `first-time-pass ÷ inspected` (inspection yield).
   They can legitimately differ; the explainers state this so users don't read a
   gap as an error.

**Scope behaviour (intentional, documented)**
5. The Production Overview work-order list is **scoped but not date-windowed**, so
   planned/future WOs still appear (otherwise KPI counts would include orders the
   table hides). This is deliberate and now noted.

**No incorrect logic was found in the reviewed dashboards in this pass.** Several
logic corrections (FPY definition, MTTR/MTBF scope & uptime basis, Downtime Pareto
scope, OEE rollup) were already applied earlier in the project and remain in place.

---

## 5. Remaining screens (same pattern applies)

Not yet wired with an explainer (extend by adding an entry to
`dashboard-explainers.ts` and dropping `<DashboardInfo id="…" />` in the header):

- `manufacturing/manufacturing-overview`, `manufacturing-oee-view`, `manufacturing-kpi-view`, `manufacturing-reports-view`
- `analytics/factory-analytics-view`
- `plm/plm-overview`, `plm/plm-reports-view`
- `quality/quality-spc-view` (SPC control charts — document Cp/Cpk, UCL/LCL, rule violations)
- `iot/historian-trend-view`
- `shop-floor/jo-live-dashboard`
- the per-module `*-reports-view` pages and the Report Builder

**Recommended explainer content to add for SPC** (highest analytical value):
- **Cp / Cpk** = process capability vs spec width; target Cpk ≥ 1.33.
- **UCL/LCL** = mean ± 3σ control limits; points outside = special-cause.
- **Western Electric rules** for out-of-control patterns.

---

## 6. How to extend

1. Add an entry to `EXPLAINERS` in `apps/web/src/lib/dashboard-explainers.ts`
   (bilingual `{ en, ar }` for every string).
2. Import and place `<DashboardInfo id="your-id" />` next to the page `<h1>`.
3. Keep formulas identical to Section 2 so cross-screen numbers stay reconcilable.
4. If a screen's number disagrees with another screen using the same metric,
   that is a **real bug** — fix the data source, don't fork the formula.
