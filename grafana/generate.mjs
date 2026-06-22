#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// MES360° — Grafana dashboard generator
// Emits production-ready dashboard JSON into grafana/dashboards/<cat>/.
// Run:  node grafana/generate.mjs
// All output is committed to source control; provisioning loads it on boot.
// ════════════════════════════════════════════════════════════════
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'dashboards');

// ── Datasources (stable UIDs from provisioning/datasources) ──────
const PG = { type: 'postgres', uid: 'mes_postgres' };
const INFLUX = { type: 'influxdb', uid: 'mes_influxdb' };
const PROM = { type: 'prometheus', uid: 'mes_prometheus' };
const EXPR = { type: '__expr__', uid: '__expr__' };

// Saudi Riyal — Grafana has no built-in SAR unit, so use its custom-currency syntax.
const SAR = 'currency:SAR ';

// ── Standard factory-context template variables ──────────────────
// Values are passed in by the Dashboard Center embed URL (var-factory=<code>,
// var-area=<id>, …). Each is also a query variable so users can pick manually.
function queryVar(name, label, sql, { multi = false } = {}) {
  return {
    name, label,
    type: 'query',
    datasource: PG,
    definition: sql,
    query: sql,
    refresh: 2,            // on time range change
    includeAll: true,
    allValue: '',
    multi,
    current: {},
    options: [],
    sort: 1,
    hide: 0,
  };
}

function standardVars() {
  // Default factory = SIDCO (Saudi Industrial Detergent Company).
  const factory = queryVar('factory', 'Factory',
    `SELECT name AS "__text", code AS "__value" FROM factories WHERE "isActive" = true ORDER BY name`,
    { multi: false });
  factory.current = { selected: true, text: 'Saudi Industrial Detergent Company', value: 'SIDCO' };
  factory.options = [{ selected: true, text: 'Saudi Industrial Detergent Company', value: 'SIDCO' }];

  return [
    factory,
    queryVar('area', 'Area',
      `SELECT a.name AS "__text", a.id AS "__value" FROM areas a JOIN factories f ON f.id = a."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY a.name`),
    queryVar('line', 'Production Line',
      `SELECT l.name AS "__text", l.id AS "__value" FROM production_lines l JOIN factories f ON f.id = l."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY l.name`),
    queryVar('machine', 'Machine',
      `SELECT m.name AS "__text", m.id AS "__value" FROM machines m JOIN factories f ON f.id = m."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY m.name`),
    queryVar('shift', 'Shift',
      `SELECT s.name AS "__text", s.id AS "__value" FROM shift_templates s JOIN factories f ON f.id = s."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY s.name`),
    queryVar('product', 'Product',
      `SELECT k.name AS "__text", k.id AS "__value" FROM skus k JOIN factories f ON f.id = k."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY k.name`),
    queryVar('batch', 'Batch',
      `SELECT b."batchNumber" AS "__text", b.id AS "__value" FROM batch_records b JOIN factories f ON f.id = b."factoryId" WHERE ('$factory' = '' OR f.code = '$factory') ORDER BY b."startTime" DESC NULLS LAST LIMIT 500`),
  ];
}

// SQL fragments reused for factory/machine/line scoping.
const F_JOIN = `JOIN factories f ON f.id = t."factoryId"`;
const F_WHERE = `('$factory' = '' OR f.code = '$factory')`;
const M_WHERE = `('$machine' = '' OR t."machineId" = '$machine')`;
const L_WHERE = `('$line' = '' OR t."lineId" = '$line')`;

// ── Panel builders (gridPos assigned later by layout) ────────────
let _pid = 0;
const nextId = () => ++_pid;

function pgTarget(sql, format = 'table', refId = 'A') {
  return { refId, format, datasource: PG, rawSql: sql };
}

function thresholds(steps) {
  return { mode: 'absolute', steps };
}

function stat(title, sql, { unit = 'short', w = 4, h = 4, decimals = 0, steps, colorMode = 'value', graphMode = 'area' } = {}) {
  return {
    id: nextId(), title, type: 'stat', datasource: PG, w, h,
    targets: [pgTarget(sql)],
    fieldConfig: { defaults: { unit, decimals, color: { mode: 'thresholds' }, thresholds: thresholds(steps ?? [{ color: 'blue', value: null }]) }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode, graphMode, justifyMode: 'auto', textMode: 'auto', orientation: 'auto' },
  };
}

function gauge(title, sql, { unit = 'percent', min = 0, max = 100, w = 6, h = 7, steps } = {}) {
  return {
    id: nextId(), title, type: 'gauge', datasource: PG, w, h,
    targets: [pgTarget(sql)],
    fieldConfig: { defaults: { unit, min, max, color: { mode: 'thresholds' }, thresholds: thresholds(steps ?? [{ color: 'red', value: null }, { color: 'orange', value: 60 }, { color: 'green', value: 85 }]) }, overrides: [] },
    options: { showThresholdLabels: false, showThresholdMarkers: true, reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false } },
  };
}

function timeseries(title, targets, { unit = 'short', w = 12, h = 8, stack = false, fill = 10 } = {}) {
  return {
    id: nextId(), title, type: 'timeseries', datasource: PG, w, h,
    targets,
    fieldConfig: {
      defaults: {
        unit, custom: {
          drawStyle: 'line', lineInterpolation: 'smooth', lineWidth: 2, fillOpacity: fill,
          showPoints: 'never', spanNulls: true, stacking: { mode: stack ? 'normal' : 'none', group: 'A' },
          axisLabel: '', gradientMode: 'opacity',
        },
        color: { mode: 'palette-classic' },
      },
      overrides: [],
    },
    options: { legend: { displayMode: 'list', placement: 'bottom', calcs: [] }, tooltip: { mode: 'multi', sort: 'desc' } },
  };
}

function barchart(title, sql, { unit = 'short', w = 12, h = 8, horizontal = false } = {}) {
  return {
    id: nextId(), title, type: 'barchart', datasource: PG, w, h,
    targets: [pgTarget(sql)],
    fieldConfig: { defaults: { unit, color: { mode: 'palette-classic' }, custom: { lineWidth: 1, fillOpacity: 80, gradientMode: 'hue' } }, overrides: [] },
    options: { orientation: horizontal ? 'horizontal' : 'vertical', showValue: 'auto', legend: { showLegend: false }, xTickLabelRotation: horizontal ? 0 : -30 },
  };
}

function piechart(title, sql, { w = 8, h = 8, unit = 'short', donut = true } = {}) {
  return {
    id: nextId(), title, type: 'piechart', datasource: PG, w, h,
    targets: [pgTarget(sql)],
    fieldConfig: { defaults: { unit, color: { mode: 'palette-classic' } }, overrides: [] },
    options: { pieType: donut ? 'donut' : 'pie', legend: { displayMode: 'list', placement: 'right', values: ['value', 'percent'] }, reduceOptions: { calcs: ['lastNotNull'], values: true } },
  };
}

function table(title, sql, { w = 24, h = 9 } = {}) {
  return {
    id: nextId(), title, type: 'table', datasource: PG, w, h,
    targets: [pgTarget(sql)],
    fieldConfig: { defaults: { custom: { align: 'auto', filterable: true } }, overrides: [] },
    options: { showHeader: true, footer: { show: false }, cellHeight: 'sm' },
  };
}

function heatmap(title, sql, { w = 24, h = 9 } = {}) {
  return {
    id: nextId(), title, type: 'heatmap', datasource: PG, w, h,
    targets: [pgTarget(sql, 'time_series')],
    options: { calculate: false, color: { scheme: 'Oranges', mode: 'scheme', steps: 64 }, cellGap: 1, yAxis: { unit: 'short' } },
  };
}

function influxPanel(title, flux, { w = 12, h = 8, unit = 'short', type = 'timeseries' } = {}) {
  return {
    id: nextId(), title, type, datasource: INFLUX, w, h,
    targets: [{ refId: 'A', datasource: INFLUX, query: flux }],
    fieldConfig: { defaults: { unit, color: { mode: 'palette-classic' }, custom: { drawStyle: 'line', fillOpacity: 10, lineWidth: 2, showPoints: 'never' } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  };
}

function promPanel(title, expr, { w = 12, h = 8, unit = 'short', legend = '{{instance}}' } = {}) {
  return {
    id: nextId(), title, type: 'timeseries', datasource: PROM, w, h,
    targets: [{ refId: 'A', datasource: PROM, expr, legendFormat: legend }],
    fieldConfig: { defaults: { unit, color: { mode: 'palette-classic' }, custom: { drawStyle: 'line', fillOpacity: 10, lineWidth: 2, showPoints: 'never' } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
  };
}

function row(title) {
  return { id: nextId(), title, type: 'row', w: 24, h: 1, collapsed: false };
}

// ── Auto-layout: pack panels left→right, wrap at 24 cols ─────────
function layout(panels) {
  let x = 0, y = 0, rowH = 0;
  for (const p of panels) {
    const w = p.w ?? 12, h = p.h ?? 8;
    if (p.type === 'row') { x = 0; y += rowH; rowH = 0; p.gridPos = { x: 0, y, w: 24, h: 1 }; y += 1; delete p.w; delete p.h; continue; }
    if (x + w > 24) { x = 0; y += rowH; rowH = 0; }
    p.gridPos = { x, y, w, h };
    x += w; rowH = Math.max(rowH, h);
    delete p.w; delete p.h;
  }
  return panels;
}

// ── Dashboard wrapper ────────────────────────────────────────────
function mkDash({ uid, title, description = '', tags = [], panels, refresh = '30s', time = 'now-24h' }) {
  _pid = 0;
  return {
    uid, title, description,
    tags: ['mes360', ...tags],
    schemaVersion: 39,
    version: 1,
    editable: true,
    graphTooltip: 1,
    time: { from: time, to: 'now' },
    timezone: '',
    refresh,
    templating: { list: standardVars() },
    annotations: { list: [{ builtIn: 1, datasource: { type: 'grafana', uid: '-- Grafana --' }, enable: true, hide: true, iconColor: 'rgba(0, 211, 255, 1)', name: 'Annotations & Alerts', type: 'dashboard' }] },
    panels: layout(panels),
  };
}

// OEE color steps
const OEE_STEPS = [{ color: 'red', value: null }, { color: 'orange', value: 60 }, { color: 'yellow', value: 75 }, { color: 'green', value: 85 }];
const GOOD_HIGH = [{ color: 'red', value: null }, { color: 'orange', value: 50 }, { color: 'green', value: 90 }];
const BAD_HIGH = [{ color: 'green', value: null }, { color: 'orange', value: 5 }, { color: 'red', value: 10 }];

// =================================================================
// DASHBOARD DEFINITIONS
// =================================================================
const DASHBOARDS = [];
const D = (folder, def) => DASHBOARDS.push({ folder, def });

// scoped OEE base where-clause
const OEE_W = `${F_JOIN} WHERE $__timeFilter(t."recordDate") AND ${F_WHERE} AND ${M_WHERE}`;

// ── PRODUCTION ───────────────────────────────────────────────────
D('production', mkDash({
  uid: 'mes-prod-overview', title: 'Production Overview', tags: ['production'],
  description: 'Real-time production output, achievement and losses.',
  panels: [
    stat('Planned Qty', `SELECT COALESCE(SUM("plannedProductionMin"),0) AS value FROM oee_records t ${OEE_W}`, { steps: [{ color: 'blue', value: null }] }),
    stat('Actual Output', `SELECT COALESCE(SUM("totalOutput"),0) AS value FROM oee_records t ${OEE_W}`, { steps: [{ color: 'green', value: null }] }),
    stat('Good Output', `SELECT COALESCE(SUM("goodOutput"),0) AS value FROM oee_records t ${OEE_W}`, { steps: GOOD_HIGH }),
    stat('Scrap %', `SELECT CASE WHEN SUM("totalOutput")>0 THEN ROUND(100.0*SUM("scrapOutput")/SUM("totalOutput"),2) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: BAD_HIGH }),
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Availability', `SELECT COALESCE(AVG(availability),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Performance', `SELECT COALESCE(AVG(performance),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Quality', `SELECT COALESCE(AVG(quality),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    timeseries('Output vs Good (trend)', [
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), SUM("totalOutput") AS "Total Output" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'A'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), SUM("goodOutput") AS "Good Output" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'B'),
    ], { w: 16 }),
    piechart('Output by Machine', `SELECT m.name AS metric, SUM(t."totalOutput") AS value FROM oee_records t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") AND ${F_WHERE} GROUP BY m.name ORDER BY value DESC LIMIT 10`, { w: 8 }),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-orders', title: 'Production Orders', tags: ['production'],
  description: 'Work order portfolio, status and progress.',
  panels: [
    stat('Total WOs', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL`),
    stat('In Progress', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status='IN_PROGRESS' AND t."deletedAt" IS NULL`, { steps: [{ color: 'blue', value: null }] }),
    stat('Completed', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status='COMPLETED' AND t."deletedAt" IS NULL`, { steps: [{ color: 'green', value: null }] }),
    stat('On Hold', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status='ON_HOLD' AND t."deletedAt" IS NULL`, { steps: [{ color: 'orange', value: null }] }),
    piechart('WO Status Mix', `SELECT t.status AS metric, COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL GROUP BY t.status`, { w: 8 }),
    barchart('WOs by Priority', `SELECT t.priority AS metric, COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL GROUP BY t.priority ORDER BY value DESC`, { w: 8 }),
    timeseries('WO Completions (trend)', [pgTarget(`SELECT $__timeGroupAlias(t."actualEnd",$__interval), COUNT(*) AS "Completed" FROM work_orders t ${F_JOIN} WHERE $__timeFilter(t."actualEnd") AND ${F_WHERE} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 8 }),
    table('Active Work Orders', `SELECT t."orderNumber" AS "WO #", k.name AS "Product", t.status AS "Status", t.priority AS "Priority", t."plannedQty" AS "Planned", t."plannedEnd" AS "Planned End" FROM work_orders t JOIN factories f ON f.id=t."factoryId" LEFT JOIN skus k ON k.id=t."skuId" WHERE ${F_WHERE} AND t.status IN ('PLANNED','RELEASED','IN_PROGRESS','ON_HOLD') AND t."deletedAt" IS NULL ORDER BY t."plannedEnd" LIMIT 50`),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-shift', title: 'Shift Performance', tags: ['production', 'shift'],
  description: 'Output, OEE and losses by shift instance.',
  panels: [
    stat('Shift Output', `SELECT COALESCE(SUM("actualQty"),0) AS value FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE}`, { steps: [{ color: 'green', value: null }] }),
    stat('Target', `SELECT COALESCE(SUM("targetQty"),0) AS value FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE}`, { steps: [{ color: 'blue', value: null }] }),
    stat('Avg OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Downtime (min)', `SELECT COALESCE(SUM("downtimeMinutes"),0) AS value FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE}`, { unit: 'm', steps: BAD_HIGH }),
    timeseries('Shift Output vs Target', [
      pgTarget(`SELECT $__timeGroupAlias(t."shiftDate",$__interval), SUM("actualQty") AS "Actual" FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE} GROUP BY 1 ORDER BY 1`, 'time_series', 'A'),
      pgTarget(`SELECT $__timeGroupAlias(t."shiftDate",$__interval), SUM("targetQty") AS "Target" FROM shift_instances t ${F_JOIN} WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE} GROUP BY 1 ORDER BY 1`, 'time_series', 'B'),
    ], { w: 24 }),
    table('Shift Detail', `SELECT s.name AS "Shift", t."shiftDate" AS "Date", t."actualQty" AS "Actual", t."targetQty" AS "Target", t."goodQty" AS "Good", t."scrapQty" AS "Scrap", ROUND(t.oee::numeric,1) AS "OEE %" FROM shift_instances t JOIN factories f ON f.id=t."factoryId" JOIN shift_templates s ON s.id=t."shiftTemplateId" WHERE $__timeFilter(t."shiftDate") AND ${F_WHERE} ORDER BY t."shiftDate" DESC LIMIT 50`),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-scheduling', title: 'Production Scheduling', tags: ['production'],
  description: 'Schedule adherence and upcoming order load.',
  panels: [
    stat('Scheduled (7d)', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."plannedStart" BETWEEN NOW() AND NOW()+INTERVAL '7 days' AND t."deletedAt" IS NULL`, { steps: [{ color: 'blue', value: null }] }),
    stat('Late Start', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."plannedStart" < NOW() AND t.status='PLANNED' AND t."deletedAt" IS NULL`, { steps: [{ color: 'red', value: null }] }),
    stat('Behind Schedule', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."plannedEnd" < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED') AND t."deletedAt" IS NULL`, { steps: [{ color: 'orange', value: null }] }),
    table('Upcoming Schedule', `SELECT t."orderNumber" AS "WO #", k.name AS "Product", t."plannedStart" AS "Start", t."plannedEnd" AS "End", t.status AS "Status", t."plannedQty" AS "Qty" FROM work_orders t JOIN factories f ON f.id=t."factoryId" LEFT JOIN skus k ON k.id=t."skuId" WHERE ${F_WHERE} AND t."plannedStart" >= NOW()-INTERVAL '1 day' AND t."deletedAt" IS NULL ORDER BY t."plannedStart" LIMIT 60`),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-scrap', title: 'Scrap Analysis', tags: ['production', 'quality'],
  description: 'Scrap quantities, cost and reasons.',
  panels: [
    stat('Total Scrap', `SELECT COALESCE(SUM(t.qty),0) AS value FROM scrap_logs t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE}`, { steps: BAD_HIGH }),
    stat('Scrap Events', `SELECT COUNT(*) AS value FROM scrap_logs t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE}`, { steps: [{ color: 'orange', value: null }] }),
    barchart('Scrap by Reason', `SELECT COALESCE(t.reason, t.category::text, 'Unknown') AS metric, SUM(t.qty) AS value FROM scrap_logs t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE} GROUP BY 1 ORDER BY value DESC LIMIT 12`, { w: 16, horizontal: true }),
    timeseries('Scrap Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), SUM(t.qty) AS "Scrap" FROM scrap_logs t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 }),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-batch', title: 'Batch Performance', tags: ['production', 'batch'],
  description: 'Batch yield and disposition.',
  panels: [
    stat('Batches', `SELECT COUNT(*) AS value FROM batch_records t ${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE}`),
    stat('Good Qty', `SELECT COALESCE(SUM("goodQuantity"),0) AS value FROM batch_records t ${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE}`, { steps: GOOD_HIGH }),
    stat('Scrap Qty', `SELECT COALESCE(SUM("scrapQuantity"),0) AS value FROM batch_records t ${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE}`, { steps: BAD_HIGH }),
    stat('Avg Yield %', `SELECT CASE WHEN SUM(quantity)>0 THEN ROUND(100.0*SUM("goodQuantity")/SUM(quantity),1) ELSE 0 END AS value FROM batch_records t ${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE}`, { unit: 'percent', steps: OEE_STEPS }),
    table('Recent Batches', `SELECT t."batchNumber" AS "Batch", k.name AS "Product", t.status AS "Status", t.quantity AS "Qty", t."goodQuantity" AS "Good", t."scrapQuantity" AS "Scrap", t."startTime" AS "Start" FROM batch_records t JOIN factories f ON f.id=t."factoryId" LEFT JOIN skus k ON k.id=t."skuId" WHERE ${F_WHERE} ORDER BY t."startTime" DESC NULLS LAST LIMIT 50`),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-throughput', title: 'Throughput Monitoring', tags: ['production'],
  description: 'Production rate and cycle time.',
  panels: [
    stat('Avg Rate (u/h)', `SELECT CASE WHEN SUM(t."uptimeMin")>0 THEN ROUND((60.0*SUM(t."totalOutput")/NULLIF(SUM(t."uptimeMin"),0))::numeric,1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { steps: GOOD_HIGH }),
    stat('Runtime (h)', `SELECT ROUND(COALESCE(SUM(t."uptimeMin"),0)::numeric/60.0,1) AS value FROM oee_records t ${OEE_W}`, { unit: 'h' }),
    timeseries('Throughput (units/interval)', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), SUM(t."totalOutput") AS "Output" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 }),
    barchart('Rate by Machine (u/h)', `SELECT m.name AS metric, CASE WHEN SUM(t."uptimeMin")>0 THEN ROUND((60.0*SUM(t."totalOutput")/NULLIF(SUM(t."uptimeMin"),0))::numeric,1) ELSE 0 END AS value FROM oee_records t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") AND ${F_WHERE} GROUP BY m.name ORDER BY value DESC LIMIT 12`, { w: 24, horizontal: true }),
  ],
}));

D('production', mkDash({
  uid: 'mes-prod-kpi', title: 'Production KPI Dashboard', tags: ['production', 'kpi'],
  description: 'Consolidated production KPIs.',
  panels: [
    stat('Achievement %', `SELECT CASE WHEN SUM("plannedProductionMin")>0 THEN ROUND((100.0*SUM("totalOutput")/NULLIF(SUM("plannedProductionMin"),0))::numeric,1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Yield %', `SELECT CASE WHEN SUM("totalOutput")>0 THEN ROUND(100.0*SUM("goodOutput")/SUM("totalOutput"),1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Scrap %', `SELECT CASE WHEN SUM("totalOutput")>0 THEN ROUND(100.0*SUM("scrapOutput")/SUM("totalOutput"),2) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: BAD_HIGH }),
    stat('Downtime %', `SELECT CASE WHEN SUM("plannedProductionMin")>0 THEN ROUND((100.0*SUM("downtimeMin")/NULLIF(SUM("plannedProductionMin"),0))::numeric,1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: BAD_HIGH }),
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Availability', `SELECT COALESCE(AVG(availability),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    timeseries('OEE Components Trend', [
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(availability) AS "Availability" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'A'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(performance) AS "Performance" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'B'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(quality) AS "Quality" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'C'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'D'),
    ], { w: 24, unit: 'percent' }),
  ],
}));

// ── OEE (in Production folder per catalog, but spec lists separately → put in production) ──
const oeeDash = (uid, title, groupCol, groupJoin, groupName) => mkDash({
  uid, title, tags: ['oee', 'production'],
  description: `OEE breakdown by ${groupName}.`,
  panels: [
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Availability', `SELECT COALESCE(AVG(availability),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Performance', `SELECT COALESCE(AVG(performance),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    gauge('Quality', `SELECT COALESCE(AVG(quality),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    barchart(`OEE by ${groupName}`, `SELECT ${groupCol} AS metric, ROUND(AVG(t.oee)::numeric,1) AS value FROM oee_records t ${groupJoin} JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") AND ${F_WHERE} GROUP BY 1 ORDER BY value DESC LIMIT 15`, { w: 24, unit: 'percent', horizontal: true }),
    timeseries('OEE Trend', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'percent' }),
  ],
});

D('production', oeeDash('mes-oee-executive', 'OEE Executive', `f.name`, ``, 'Factory'));
D('production', oeeDash('mes-oee-factory', 'OEE by Factory', `f.name`, ``, 'Factory'));
D('production', oeeDash('mes-oee-line', 'OEE by Line', `COALESCE(l.name,'Unassigned')`, `JOIN machines m ON m.id=t."machineId" LEFT JOIN production_lines l ON l.id=m."lineId"`, 'Line'));
D('production', oeeDash('mes-oee-machine', 'OEE by Machine', `m.name`, `JOIN machines m ON m.id=t."machineId"`, 'Machine'));
D('production', mkDash({
  uid: 'mes-oee-trend', title: 'OEE Trend Analysis', tags: ['oee', 'production'],
  description: 'Long-range OEE and loss decomposition.',
  panels: [
    timeseries('OEE & Components', [
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'A'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(availability) AS "Availability" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'B'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(performance) AS "Performance" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'C'),
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(quality) AS "Quality" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'D'),
    ], { w: 24, unit: 'percent' }),
    stat('Planned Time (h)', `SELECT ROUND(COALESCE(SUM("plannedProductionMin"),0)::numeric/60.0,1) AS value FROM oee_records t ${OEE_W}`, { unit: 'h' }),
    stat('Runtime (h)', `SELECT ROUND(COALESCE(SUM("uptimeMin"),0)::numeric/60.0,1) AS value FROM oee_records t ${OEE_W}`, { unit: 'h', steps: [{ color: 'green', value: null }] }),
    stat('Stop Time (h)', `SELECT ROUND(COALESCE(SUM("downtimeMin"),0)::numeric/60.0,1) AS value FROM oee_records t ${OEE_W}`, { unit: 'h', steps: BAD_HIGH }),
    stat('Micro Stops', `SELECT COUNT(*) AS value FROM downtime_events t ${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE} AND t."durationMinutes" < 5`, { steps: [{ color: 'orange', value: null }] }),
  ],
}));

// ── DOWNTIME (production folder) ─────────────────────────────────
const DT_W = `${F_JOIN} WHERE $__timeFilter(t."startTime") AND ${F_WHERE} AND ${M_WHERE}`;
D('production', mkDash({
  uid: 'mes-dt-overview', title: 'Downtime Overview', tags: ['downtime', 'production'],
  description: 'Downtime totals, frequency and split.',
  panels: [
    stat('Total Downtime (min)', `SELECT COALESCE(SUM(t."durationMinutes"),0) AS value FROM downtime_events t ${DT_W}`, { unit: 'm', steps: BAD_HIGH }),
    stat('Events', `SELECT COUNT(*) AS value FROM downtime_events t ${DT_W}`, { steps: [{ color: 'orange', value: null }] }),
    stat('Planned', `SELECT COUNT(*) AS value FROM downtime_events t ${DT_W} AND t."isPlanned"=true`, { steps: [{ color: 'blue', value: null }] }),
    stat('Unplanned', `SELECT COUNT(*) AS value FROM downtime_events t ${DT_W} AND t."isPlanned"=false`, { steps: [{ color: 'red', value: null }] }),
    piechart('Downtime by Category', `SELECT t.category AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY t.category`, { w: 8 }),
    timeseries('Downtime Trend (min)', [pgTarget(`SELECT $__timeGroupAlias(t."startTime",$__interval), SUM(t."durationMinutes") AS "Downtime" FROM downtime_events t ${DT_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16, unit: 'm' }),
  ],
}));

D('production', mkDash({
  uid: 'mes-dt-pareto', title: 'Downtime Pareto', tags: ['downtime'],
  description: 'Pareto of downtime by reason code.',
  panels: [
    barchart('Downtime by Reason (min)', `SELECT t."reasonCode" AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY t."reasonCode" ORDER BY value DESC LIMIT 15`, { w: 24, unit: 'm', horizontal: true }),
    table('Pareto Detail', `SELECT t."reasonCode" AS "Reason", COUNT(*) AS "Events", ROUND(SUM(t."durationMinutes")::numeric,0) AS "Total Min", ROUND(AVG(t."durationMinutes")::numeric,1) AS "Avg Min" FROM downtime_events t ${DT_W} GROUP BY t."reasonCode" ORDER BY 3 DESC`),
  ],
}));

D('production', mkDash({
  uid: 'mes-dt-heatmap', title: 'Downtime Heatmap', tags: ['downtime'],
  description: 'Downtime intensity over time.',
  panels: [
    heatmap('Downtime Heatmap (min by interval)', `SELECT $__timeGroupAlias(t."startTime",'1h'), SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY 1 ORDER BY 1`),
    barchart('Downtime by Hour of Day', `SELECT EXTRACT(HOUR FROM t."startTime")::text AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY 1 ORDER BY 1`, { w: 24, unit: 'm' }),
  ],
}));

D('production', mkDash({
  uid: 'mes-dt-rca', title: 'Root Cause Analysis', tags: ['downtime'],
  description: 'Downtime cause attribution.',
  panels: [
    piechart('By Category', `SELECT t.category AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY t.category`, { w: 8 }),
    piechart('By Reason Code', `SELECT t."reasonCode" AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t ${DT_W} GROUP BY t."reasonCode"`, { w: 8 }),
    barchart('Top Causes', `SELECT COALESCE(c.name, t."reasonCode"::text) AS metric, SUM(t."durationMinutes") AS value FROM downtime_events t LEFT JOIN downtime_causes c ON c.id=t."causeId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."startTime") AND ${F_WHERE} GROUP BY 1 ORDER BY value DESC LIMIT 10`, { w: 8, horizontal: true }),
    table('Downtime Events', `SELECT m.name AS "Machine", t.category AS "Category", t."reasonCode" AS "Reason", t."durationMinutes" AS "Minutes", t."startTime" AS "Start" FROM downtime_events t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."startTime") AND ${F_WHERE} ORDER BY t."startTime" DESC LIMIT 60`),
  ],
}));

const mtbfPanels = (extra = []) => [
  stat('MTTR (h)', `SELECT ROUND(COALESCE(AVG(t."actualHours"),0)::numeric,1) AS value FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.status='COMPLETED' AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."completedAt") AND t."deletedAt" IS NULL`, { unit: 'h', steps: BAD_HIGH }),
  stat('Failures', `SELECT COUNT(*) AS value FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."createdAt") AND t."deletedAt" IS NULL`, { steps: [{ color: 'orange', value: null }] }),
  ...extra,
];
D('production', mkDash({
  uid: 'mes-mtbf', title: 'MTBF Analytics', tags: ['downtime', 'reliability'],
  description: 'Mean time between failures.',
  panels: [
    ...mtbfPanels(),
    timeseries('Failures Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), COUNT(*) AS "Failures" FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."createdAt") AND t."deletedAt" IS NULL GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 }),
  ],
}));
D('production', mkDash({
  uid: 'mes-mttr', title: 'MTTR Analytics', tags: ['downtime', 'reliability'],
  description: 'Mean time to repair.',
  panels: [
    ...mtbfPanels(),
    timeseries('Avg Repair Hours Trend', [pgTarget(`SELECT $__timeGroupAlias(t."completedAt",$__interval), AVG(t."actualHours") AS "MTTR (h)" FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.status='COMPLETED' AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."completedAt") AND t."deletedAt" IS NULL GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'h' }),
  ],
}));

// ── MANUFACTURING ───────────────────────────────────────────────
D('manufacturing', mkDash({
  uid: 'mes-mfg-overview', title: 'Manufacturing Overview', tags: ['manufacturing'],
  description: 'Execution status across work and job orders.',
  panels: [
    stat('WIP (Job Orders)', `SELECT COUNT(*) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND j.status IN ('READY','EXECUTING','PAUSED')`, { steps: [{ color: 'blue', value: null }] }),
    stat('WOs In Progress', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status='IN_PROGRESS' AND t."deletedAt" IS NULL`, { steps: [{ color: 'blue', value: null }] }),
    stat('Completed Today', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status='COMPLETED' AND t."actualEnd"::date = NOW()::date AND t."deletedAt" IS NULL`, { steps: [{ color: 'green', value: null }] }),
    stat('Avg OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    piechart('Job Order Status', `SELECT j.status AS metric, COUNT(*) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} GROUP BY j.status`, { w: 8 }),
    timeseries('Output Trend', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), SUM(t."totalOutput") AS "Output" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16 }),
  ],
}));

D('manufacturing', mkDash({
  uid: 'mes-mfg-wo-status', title: 'Work Order Status', tags: ['manufacturing'],
  description: 'WO completion and schedule adherence.',
  panels: [
    stat('Completion %', `SELECT CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE t.status='COMPLETED')/COUNT(*),1) ELSE 0 END AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Open', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t.status NOT IN ('COMPLETED','CANCELLED') AND t."deletedAt" IS NULL`, { steps: [{ color: 'blue', value: null }] }),
    stat('Overdue', `SELECT COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."plannedEnd" < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED') AND t."deletedAt" IS NULL`, { steps: [{ color: 'red', value: null }] }),
    barchart('WO by Status', `SELECT t.status AS metric, COUNT(*) AS value FROM work_orders t ${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL GROUP BY t.status ORDER BY value DESC`, { w: 12 }),
    table('Work Orders', `SELECT t."orderNumber" AS "WO #", k.name AS "Product", t.status AS "Status", t."plannedQty" AS "Planned", t."plannedEnd" AS "Due" FROM work_orders t JOIN factories f ON f.id=t."factoryId" LEFT JOIN skus k ON k.id=t."skuId" WHERE ${F_WHERE} AND t."deletedAt" IS NULL ORDER BY t."plannedEnd" DESC LIMIT 50`, { w: 12 }),
  ],
}));

D('manufacturing', mkDash({
  uid: 'mes-mfg-dispatch', title: 'Dispatch List Monitoring', tags: ['manufacturing', 'isa95'],
  description: 'Job order dispatch list (ISA-95).',
  panels: [
    stat('Ready', `SELECT COUNT(*) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND j.status='READY'`, { steps: [{ color: 'blue', value: null }] }),
    stat('Executing', `SELECT COUNT(*) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND j.status='EXECUTING'`, { steps: [{ color: 'green', value: null }] }),
    stat('Paused', `SELECT COUNT(*) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND j.status='PAUSED'`, { steps: [{ color: 'orange', value: null }] }),
    table('Dispatch List', `SELECT t."orderNumber" AS "WO #", j."operationName" AS "Operation", j."sequenceOrder" AS "Seq", j.status AS "Status", m.name AS "Machine", j."actualQtyGood" AS "Good" FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" LEFT JOIN machines m ON m.id=j."machineId" WHERE ${F_WHERE} AND j.status IN ('READY','EXECUTING','PAUSED','SCHEDULED') ORDER BY t."orderNumber", j."sequenceOrder" LIMIT 80`),
  ],
}));

D('manufacturing', mkDash({
  uid: 'mes-mfg-shopfloor', title: 'Shopfloor Live', tags: ['manufacturing', 'live'],
  description: 'Live machine state and utilization.', refresh: '10s', time: 'now-3h',
  panels: [
    stat('Running', `SELECT COUNT(*) AS value FROM machine_current_status t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND UPPER(t.state::text)='RUNNING'`, { steps: [{ color: 'green', value: null }] }),
    stat('Idle', `SELECT COUNT(*) AS value FROM machine_current_status t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND UPPER(t.state::text)='IDLE'`, { steps: [{ color: 'orange', value: null }] }),
    stat('Stopped/Fault', `SELECT COUNT(*) AS value FROM machine_current_status t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND UPPER(t.state::text) IN ('STOPPED','FAULT')`, { steps: [{ color: 'red', value: null }] }),
    table('Machine States', `SELECT m.name AS "Machine", m.code AS "Code", t.state AS "State", t."updatedAt" AS "Since" FROM machine_current_status t JOIN machines m ON m.id=t."machineId" JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') ORDER BY m.name LIMIT 60`),
  ],
}));

D('manufacturing', mkDash({
  uid: 'mes-mfg-recipe', title: 'Recipe Execution', tags: ['manufacturing'],
  description: 'Recipe usage across production.',
  panels: [
    stat('Active Recipes', `SELECT COUNT(*) AS value FROM recipes t ${F_JOIN}`),
    barchart('WOs by Recipe', `SELECT r.name AS metric, COUNT(*) AS value FROM work_orders t JOIN factories f ON f.id=t."factoryId" LEFT JOIN recipes r ON r.id=t."recipeId" WHERE ${F_WHERE} AND t."deletedAt" IS NULL GROUP BY r.name ORDER BY value DESC NULLS LAST LIMIT 12`, { w: 24, horizontal: true }),
  ],
}));

D('manufacturing', mkDash({
  uid: 'mes-mfg-process-perf', title: 'Process Performance', tags: ['manufacturing'],
  description: 'Cycle time and utilization by process step.',
  panels: [
    stat('Avg Cycle (s)', `SELECT ROUND(COALESCE(AVG(j."idealCycleTimeSec"),0)::numeric,1) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE}`, { unit: 's' }),
    stat('Utilization %', `SELECT COALESCE(AVG(availability),0) AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    barchart('Avg Cycle by Operation (s)', `SELECT j."operationName" AS metric, ROUND(AVG(j."idealCycleTimeSec")::numeric,1) AS value FROM job_orders j JOIN work_orders t ON t.id=j."workOrderId" JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND j."idealCycleTimeSec" IS NOT NULL GROUP BY j."operationName" ORDER BY value DESC LIMIT 12`, { w: 24, unit: 's', horizontal: true }),
  ],
}));

// ── MAINTENANCE ─────────────────────────────────────────────────
const MWO = `${F_JOIN} WHERE ${F_WHERE} AND t."deletedAt" IS NULL`;
D('maintenance', mkDash({
  uid: 'mes-maint-overview', title: 'Maintenance Overview', tags: ['maintenance'],
  description: 'Work order load, reliability and compliance.',
  panels: [
    stat('Open WOs', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.status IN ('OPEN','ASSIGNED','IN_PROGRESS')`, { steps: [{ color: 'blue', value: null }] }),
    stat('Overdue', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t."dueDate" < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')`, { steps: [{ color: 'red', value: null }] }),
    stat('MTTR (h)', `SELECT ROUND(COALESCE(AVG(t."actualHours"),0)::numeric,1) AS value FROM maintenance_wos t ${MWO} AND t.status='COMPLETED' AND $__timeFilter(t."completedAt")`, { unit: 'h', steps: BAD_HIGH }),
    stat('Cost', `SELECT ROUND(COALESCE(SUM(t."totalCost"),0)::numeric,0) AS value FROM maintenance_wos t ${MWO} AND $__timeFilter(t."createdAt")`, { unit: SAR }),
    piechart('WO by Type', `SELECT t.type AS metric, COUNT(*) AS value FROM maintenance_wos t ${MWO} GROUP BY t.type`, { w: 8 }),
    timeseries('Completed WOs Trend', [pgTarget(`SELECT $__timeGroupAlias(t."completedAt",$__interval), COUNT(*) AS "Completed" FROM maintenance_wos t ${MWO} AND $__timeFilter(t."completedAt") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16 }),
  ],
}));

D('maintenance', mkDash({
  uid: 'mes-maint-pm', title: 'Preventive Maintenance', tags: ['maintenance', 'pm'],
  description: 'PM compliance and schedule.',
  panels: [
    stat('PM Due (30d)', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.type IN ('PREVENTIVE','INSPECTION','LUBRICATION') AND t."dueDate" BETWEEN NOW() AND NOW()+INTERVAL '30 days'`, { steps: [{ color: 'blue', value: null }] }),
    stat('PM Overdue', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.type IN ('PREVENTIVE','INSPECTION','LUBRICATION') AND t."dueDate" < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')`, { steps: [{ color: 'red', value: null }] }),
    stat('PM Compliance %', `SELECT CASE WHEN COUNT(*) FILTER (WHERE t."dueDate" <= NOW())>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE t.status='COMPLETED' AND t."dueDate" <= NOW())/COUNT(*) FILTER (WHERE t."dueDate" <= NOW()),1) ELSE 100 END AS value FROM maintenance_wos t ${MWO} AND t.type IN ('PREVENTIVE','INSPECTION','LUBRICATION') AND $__timeFilter(t."dueDate")`, { unit: 'percent', steps: OEE_STEPS }),
    table('Upcoming PM', `SELECT t."woNumber" AS "WO #", m.name AS "Asset", t.type AS "Type", t."dueDate" AS "Due", t.status AS "Status" FROM maintenance_wos t JOIN factories f ON f.id=t."factoryId" JOIN machines m ON m.id=t."machineId" WHERE ${F_WHERE} AND t.type IN ('PREVENTIVE','INSPECTION','LUBRICATION') AND t.status NOT IN ('COMPLETED','CANCELLED') AND t."deletedAt" IS NULL ORDER BY t."dueDate" LIMIT 50`),
  ],
}));

D('maintenance', mkDash({
  uid: 'mes-maint-wo', title: 'Work Orders', tags: ['maintenance'],
  description: 'Maintenance work order portfolio.',
  panels: [
    piechart('By Status', `SELECT t.status AS metric, COUNT(*) AS value FROM maintenance_wos t ${MWO} GROUP BY t.status`, { w: 8 }),
    piechart('By Priority', `SELECT t.priority AS metric, COUNT(*) AS value FROM maintenance_wos t ${MWO} GROUP BY t.priority`, { w: 8 }),
    barchart('By Type', `SELECT t.type AS metric, COUNT(*) AS value FROM maintenance_wos t ${MWO} GROUP BY t.type ORDER BY value DESC`, { w: 8 }),
    table('Work Orders', `SELECT t."woNumber" AS "WO #", m.name AS "Asset", t.type AS "Type", t.priority AS "Priority", t.status AS "Status", t."dueDate" AS "Due" FROM maintenance_wos t JOIN factories f ON f.id=t."factoryId" JOIN machines m ON m.id=t."machineId" WHERE ${F_WHERE} AND t."deletedAt" IS NULL ORDER BY t."dueDate" DESC NULLS LAST LIMIT 60`),
  ],
}));

D('maintenance', mkDash({
  uid: 'mes-maint-asset-health', title: 'Asset Health', tags: ['maintenance', 'asset'],
  description: 'Asset failure load and availability.',
  panels: [
    stat('Assets', `SELECT COUNT(*) AS value FROM machines m JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND m."isActive"=true`),
    stat('Critical Assets', `SELECT COUNT(*) AS value FROM machines m JOIN factories f ON f.id=m."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND m.criticality='CRITICAL'`, { steps: [{ color: 'orange', value: null }] }),
    barchart('Failures by Asset', `SELECT m.name AS metric, COUNT(*) AS value FROM maintenance_wos t JOIN factories f ON f.id=t."factoryId" JOIN machines m ON m.id=t."machineId" WHERE ${F_WHERE} AND t.type IN ('CORRECTIVE','EMERGENCY') AND t."deletedAt" IS NULL GROUP BY m.name ORDER BY value DESC LIMIT 12`, { w: 24, horizontal: true }),
  ],
}));

D('maintenance', mkDash({
  uid: 'mes-maint-spares', title: 'Spare Parts Analytics', tags: ['maintenance', 'inventory'],
  description: 'Spare parts stock and value.',
  panels: [
    stat('Spare SKUs', `SELECT COUNT(*) AS value FROM spare_parts t ${F_JOIN}`),
    stat('Below Min', `SELECT COUNT(*) AS value FROM spare_parts t ${F_JOIN} WHERE t."stockQty" < t."minStockQty"`, { steps: [{ color: 'red', value: null }] }),
    stat('Stock Value', `SELECT ROUND(COALESCE(SUM(t."stockQty"*COALESCE(t."unitCost",0)),0)::numeric,0) AS value FROM spare_parts t ${F_JOIN}`, { unit: SAR }),
    table('Low Stock Spares', `SELECT t."partNumber" AS "Part #", t.name AS "Name", t."stockQty" AS "Stock", t."minStockQty" AS "Min", t."unitCost" AS "Unit Cost" FROM spare_parts t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND t."stockQty" < t."minStockQty" ORDER BY (t."minStockQty"-t."stockQty") DESC LIMIT 50`),
  ],
}));

D('maintenance', mkDash({ uid: 'mes-maint-mtbf', title: 'MTBF', tags: ['maintenance', 'reliability'], description: 'Mean time between failures.', panels: [...mtbfPanels(), timeseries('Failures Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), COUNT(*) AS "Failures" FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."createdAt") AND t."deletedAt" IS NULL GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 })] }));
D('maintenance', mkDash({ uid: 'mes-maint-mttr', title: 'MTTR', tags: ['maintenance', 'reliability'], description: 'Mean time to repair.', panels: [...mtbfPanels(), timeseries('MTTR Trend (h)', [pgTarget(`SELECT $__timeGroupAlias(t."completedAt",$__interval), AVG(t."actualHours") AS "MTTR" FROM maintenance_wos t ${F_JOIN} WHERE ${F_WHERE} AND t.status='COMPLETED' AND t.type IN ('CORRECTIVE','EMERGENCY') AND $__timeFilter(t."completedAt") AND t."deletedAt" IS NULL GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'h' })] }));

D('maintenance', mkDash({
  uid: 'mes-maint-kpi', title: 'Maintenance KPI Dashboard', tags: ['maintenance', 'kpi'],
  description: 'Consolidated maintenance KPIs.',
  panels: [
    stat('Open WOs', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.status IN ('OPEN','ASSIGNED','IN_PROGRESS')`, { steps: [{ color: 'blue', value: null }] }),
    stat('Overdue PM', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.type='PREVENTIVE' AND t."dueDate" < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')`, { steps: [{ color: 'red', value: null }] }),
    stat('Completion %', `SELECT CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE t.status='COMPLETED')/COUNT(*),1) ELSE 0 END AS value FROM maintenance_wos t ${MWO}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Maintenance Cost', `SELECT ROUND(COALESCE(SUM(t."totalCost"),0)::numeric,0) AS value FROM maintenance_wos t ${MWO} AND $__timeFilter(t."createdAt")`, { unit: SAR }),
    timeseries('Cost Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), SUM(t."totalCost") AS "Cost" FROM maintenance_wos t ${MWO} AND $__timeFilter(t."createdAt") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: SAR }),
  ],
}));

// ── QUALITY ─────────────────────────────────────────────────────
const NCR_W = `${F_JOIN} WHERE ${F_WHERE}`;
D('quality', mkDash({
  uid: 'mes-qual-overview', title: 'Quality Overview', tags: ['quality'],
  description: 'FPY, defects and non-conformance.',
  panels: [
    stat('FPY %', `SELECT CASE WHEN SUM(t."totalOutput")>0 THEN ROUND(100.0*SUM(t."goodOutput")/SUM(t."totalOutput"),1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Open NCRs', `SELECT COUNT(*) AS value FROM ncrs t ${NCR_W} AND t.status NOT IN ('RESOLVED','CLOSED')`, { steps: [{ color: 'orange', value: null }] }),
    stat('Critical NCRs', `SELECT COUNT(*) AS value FROM ncrs t ${NCR_W} AND t.severity='CRITICAL' AND t.status NOT IN ('RESOLVED','CLOSED')`, { steps: [{ color: 'red', value: null }] }),
    stat('Scrap %', `SELECT CASE WHEN SUM(t."totalOutput")>0 THEN ROUND(100.0*SUM(t."scrapOutput")/SUM(t."totalOutput"),2) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: BAD_HIGH }),
    piechart('NCR by Severity', `SELECT t.severity AS metric, COUNT(*) AS value FROM ncrs t ${NCR_W} GROUP BY t.severity`, { w: 8 }),
    timeseries('NCR Trend', [pgTarget(`SELECT $__timeGroupAlias(t."detectedAt",$__interval), COUNT(*) AS "NCRs" FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16 }),
  ],
}));

D('quality', mkDash({
  uid: 'mes-qual-inspections', title: 'Inspection Results', tags: ['quality'],
  description: 'Inspection pass/fail outcomes.',
  panels: [
    stat('Inspections', `SELECT COUNT(*) AS value FROM inspection_results t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE}`),
    stat('Pass Rate %', `SELECT CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE UPPER(t.result::text)='PASS')/COUNT(*),1) ELSE 0 END AS value FROM inspection_results t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE}`, { unit: 'percent', steps: OEE_STEPS }),
    piechart('Result Mix', `SELECT t.result AS metric, COUNT(*) AS value FROM inspection_results t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE} GROUP BY t.result`, { w: 8 }),
    timeseries('Inspections Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), COUNT(*) FILTER (WHERE UPPER(t.result::text)='PASS') AS "Pass", COUNT(*) FILTER (WHERE UPPER(t.result::text)='FAIL') AS "Fail" FROM inspection_results t ${F_JOIN} WHERE $__timeFilter(t."createdAt") AND ${F_WHERE} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16 }),
  ],
}));

D('quality', mkDash({
  uid: 'mes-qual-ncr', title: 'Non-Conformance', tags: ['quality', 'ncr'],
  description: 'NCR analysis by category and disposition.',
  panels: [
    stat('Total NCRs', `SELECT COUNT(*) AS value FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt")`),
    stat('Reject Qty', `SELECT COALESCE(SUM(t.quantity),0) AS value FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt")`, { steps: BAD_HIGH }),
    barchart('NCR by Defect Category', `SELECT t."defectCategory" AS metric, COUNT(*) AS value FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt") GROUP BY t."defectCategory" ORDER BY value DESC LIMIT 12`, { w: 16, horizontal: true }),
    piechart('By Disposition', `SELECT COALESCE(t.disposition,'Pending') AS metric, COUNT(*) AS value FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt") GROUP BY 1`, { w: 8 }),
    table('Open NCRs', `SELECT t."ncrNumber" AS "NCR #", t.title AS "Title", t.severity AS "Severity", t."defectCategory" AS "Category", t.quantity AS "Qty", t.status AS "Status" FROM ncrs t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND t.status NOT IN ('RESOLVED','CLOSED') ORDER BY t."detectedAt" DESC LIMIT 50`),
  ],
}));

D('quality', mkDash({
  uid: 'mes-qual-capa', title: 'CAPA Tracking', tags: ['quality', 'capa'],
  description: 'Corrective & preventive action status.',
  panels: [
    stat('Open CAPAs', `SELECT COUNT(*) AS value FROM capas t ${F_JOIN} WHERE ${F_WHERE} AND t.status NOT IN ('CLOSED','VERIFIED')`, { steps: [{ color: 'orange', value: null }] }),
    stat('Closure Rate %', `SELECT CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE t.status IN ('CLOSED','VERIFIED'))/COUNT(*),1) ELSE 0 END AS value FROM capas t ${F_JOIN} WHERE ${F_WHERE}`, { unit: 'percent', steps: OEE_STEPS }),
    piechart('CAPA by Status', `SELECT t.status AS metric, COUNT(*) AS value FROM capas t ${F_JOIN} WHERE ${F_WHERE} GROUP BY t.status`, { w: 8 }),
    table('CAPA List', `SELECT t."capaNumber" AS "CAPA #", t.title AS "Title", t.type AS "Type", t.priority AS "Priority", t.status AS "Status" FROM capas t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} ORDER BY t."createdAt" DESC LIMIT 50`, { w: 16 }),
  ],
}));

D('quality', mkDash({
  uid: 'mes-qual-spc', title: 'SPC Dashboard', tags: ['quality', 'spc'],
  description: 'Statistical process control — X-bar / R / control limits / Cpk.',
  panels: [
    stat('Measurements', `SELECT COUNT(*) AS value FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE}`),
    stat('Out of Control', `SELECT COUNT(*) AS value FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} AND t."isOutOfControl"=true`, { steps: BAD_HIGH }),
    stat('Cp', `SELECT CASE WHEN STDDEV_SAMP(t.value)>0 THEN ROUND(((MAX(t.usl)-MIN(t.lsl))/(6*STDDEV_SAMP(t.value)))::numeric,2) ELSE NULL END AS value FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} AND t.usl IS NOT NULL`, { steps: [{ color: 'red', value: null }, { color: 'orange', value: 1 }, { color: 'green', value: 1.33 }] }),
    stat('Cpk', `SELECT CASE WHEN STDDEV_SAMP(t.value)>0 THEN ROUND((LEAST((MAX(t.usl)-AVG(t.value)),(AVG(t.value)-MIN(t.lsl)))/(3*STDDEV_SAMP(t.value)))::numeric,2) ELSE NULL END AS value FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} AND t.usl IS NOT NULL`, { steps: [{ color: 'red', value: null }, { color: 'orange', value: 1 }, { color: 'green', value: 1.33 }] }),
    timeseries('X-Bar Chart (value vs control limits)', [
      pgTarget(`SELECT t."measuredAt" AS time, t.value AS "Value" FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} ORDER BY t."measuredAt"`, 'time_series', 'A'),
      pgTarget(`SELECT t."measuredAt" AS time, t.ucl AS "UCL" FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} ORDER BY t."measuredAt"`, 'time_series', 'B'),
      pgTarget(`SELECT t."measuredAt" AS time, t.cl AS "Center" FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} ORDER BY t."measuredAt"`, 'time_series', 'C'),
      pgTarget(`SELECT t."measuredAt" AS time, t.lcl AS "LCL" FROM spc_measurements t ${F_JOIN} WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND ${M_WHERE} ORDER BY t."measuredAt"`, 'time_series', 'D'),
    ], { w: 24 }),
    table('Rule Violations', `SELECT t."parameterName" AS "Parameter", t.value AS "Value", t."controlViolation" AS "Rule", t."measuredAt" AS "When" FROM spc_measurements t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."measuredAt") AND ${F_WHERE} AND t."isOutOfControl"=true ORDER BY t."measuredAt" DESC LIMIT 50`),
  ],
}));

D('quality', mkDash({
  uid: 'mes-qual-defects', title: 'Defect Analytics', tags: ['quality'],
  description: 'Defect rate and top defects.',
  panels: [
    stat('Defect Rate %', `SELECT CASE WHEN SUM(t."totalOutput")>0 THEN ROUND(100.0*SUM(t."scrapOutput")/SUM(t."totalOutput"),2) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: BAD_HIGH }),
    barchart('Top Defect Categories', `SELECT t."defectCategory" AS metric, SUM(t.quantity) AS value FROM ncrs t ${NCR_W} AND $__timeFilter(t."detectedAt") GROUP BY t."defectCategory" ORDER BY value DESC LIMIT 12`, { w: 24, horizontal: true }),
  ],
}));

// ── INVENTORY ───────────────────────────────────────────────────
D('inventory', mkDash({
  uid: 'mes-inv-overview', title: 'Inventory Overview', tags: ['inventory'],
  description: 'Stock value, coverage and reorder alerts.',
  panels: [
    stat('Raw Material SKUs', `SELECT COUNT(*) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE}`),
    stat('Spare SKUs', `SELECT COUNT(*) AS value FROM spare_parts t ${F_JOIN} WHERE ${F_WHERE}`),
    stat('Reorder Alerts', `SELECT (SELECT COUNT(*) FROM raw_materials r JOIN factories f ON f.id=r."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND r."currentStock" < COALESCE(r."reorderPoint", r."minStock")) + (SELECT COUNT(*) FROM spare_parts s JOIN factories f ON f.id=s."factoryId" WHERE ('$factory'='' OR f.code='$factory') AND s."stockQty" < s."minStockQty") AS value`, { steps: [{ color: 'red', value: null }] }),
    stat('RM Stock Value', `SELECT ROUND(COALESCE(SUM(t."currentStock"*COALESCE(t."unitCost",0)),0)::numeric,0) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE}`, { unit: SAR }),
    table('Below Reorder Point', `SELECT t.code AS "Code", t.name AS "Material", t."currentStock" AS "Stock", t."minStock" AS "Min", t."reorderPoint" AS "Reorder" FROM raw_materials t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND t."currentStock" < COALESCE(t."reorderPoint",t."minStock") ORDER BY (COALESCE(t."reorderPoint",t."minStock")-t."currentStock") DESC LIMIT 50`),
  ],
}));

D('inventory', mkDash({
  uid: 'mes-inv-raw', title: 'Raw Materials', tags: ['inventory'],
  description: 'Raw material stock levels and value.',
  panels: [
    stat('SKUs', `SELECT COUNT(*) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE}`),
    stat('Below Safety', `SELECT COUNT(*) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE} AND t."currentStock" < t."minStock"`, { steps: [{ color: 'red', value: null }] }),
    stat('Total Value', `SELECT ROUND(COALESCE(SUM(t."currentStock"*COALESCE(t."unitCost",0)),0)::numeric,0) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE}`, { unit: SAR }),
    barchart('Top Value Materials', `SELECT t.name AS metric, ROUND((t."currentStock"*COALESCE(t."unitCost",0))::numeric,0) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE} ORDER BY value DESC LIMIT 12`, { w: 24, unit: SAR, horizontal: true }),
  ],
}));

D('inventory', mkDash({
  uid: 'mes-inv-lots', title: 'Material Lots', tags: ['inventory'],
  description: 'Lot status and expiry.',
  panels: [
    stat('Active Lots', `SELECT COUNT(*) AS value FROM material_lots t ${F_JOIN} WHERE ${F_WHERE} AND t.status='ACTIVE'`, { steps: [{ color: 'green', value: null }] }),
    stat('Expiring (30d)', `SELECT COUNT(*) AS value FROM material_lots t ${F_JOIN} WHERE ${F_WHERE} AND t."expiryDate" BETWEEN NOW() AND NOW()+INTERVAL '30 days'`, { steps: [{ color: 'orange', value: null }] }),
    stat('Expired', `SELECT COUNT(*) AS value FROM material_lots t ${F_JOIN} WHERE ${F_WHERE} AND t."expiryDate" < NOW()`, { steps: [{ color: 'red', value: null }] }),
    table('Lots Expiring Soon', `SELECT t."lotNumber" AS "Lot", t."materialName" AS "Material", t."remainingQty" AS "Remaining", t.status AS "Status", t."expiryDate" AS "Expiry" FROM material_lots t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND t."expiryDate" IS NOT NULL ORDER BY t."expiryDate" LIMIT 50`),
  ],
}));

D('inventory', mkDash({
  uid: 'mes-inv-spares', title: 'Spare Parts', tags: ['inventory', 'maintenance'],
  description: 'Spare parts stock health.',
  panels: [
    stat('SKUs', `SELECT COUNT(*) AS value FROM spare_parts t ${F_JOIN} WHERE ${F_WHERE}`),
    stat('Below Min', `SELECT COUNT(*) AS value FROM spare_parts t ${F_JOIN} WHERE ${F_WHERE} AND t."stockQty" < t."minStockQty"`, { steps: [{ color: 'red', value: null }] }),
    stat('Value', `SELECT ROUND(COALESCE(SUM(t."stockQty"*COALESCE(t."unitCost",0)),0)::numeric,0) AS value FROM spare_parts t ${F_JOIN} WHERE ${F_WHERE}`, { unit: SAR }),
    table('Spare Parts', `SELECT t."partNumber" AS "Part #", t.name AS "Name", t."stockQty" AS "Stock", t."minStockQty" AS "Min", t."unitCost" AS "Unit Cost" FROM spare_parts t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} ORDER BY (t."minStockQty"-t."stockQty") DESC LIMIT 60`),
  ],
}));

D('inventory', mkDash({
  uid: 'mes-inv-turnover', title: 'Inventory Turnover', tags: ['inventory'],
  description: 'Consumption rate and movement velocity.',
  panels: [
    stat('Consumption (qty)', `SELECT COALESCE(SUM(ABS(t.quantity)),0) AS value FROM stock_movements t ${F_JOIN} WHERE ${F_WHERE} AND t."movementType"='CONSUMPTION' AND $__timeFilter(t."createdAt")`, { steps: [{ color: 'blue', value: null }] }),
    timeseries('Consumption Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), SUM(ABS(t.quantity)) AS "Consumed" FROM stock_movements t ${F_JOIN} WHERE ${F_WHERE} AND t."movementType"='CONSUMPTION' AND $__timeFilter(t."createdAt") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 }),
  ],
}));

D('inventory', mkDash({
  uid: 'mes-inv-movement', title: 'Stock Movement', tags: ['inventory'],
  description: 'Inbound/outbound stock movements.',
  panels: [
    piechart('Movement Mix', `SELECT t."movementType" AS metric, COUNT(*) AS value FROM stock_movements t ${F_JOIN} WHERE ${F_WHERE} AND $__timeFilter(t."createdAt") GROUP BY t."movementType"`, { w: 8 }),
    timeseries('Movements Trend', [pgTarget(`SELECT $__timeGroupAlias(t."createdAt",$__interval), COUNT(*) AS "Movements" FROM stock_movements t ${F_JOIN} WHERE ${F_WHERE} AND $__timeFilter(t."createdAt") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16 }),
    table('Recent Movements', `SELECT t."entityCode" AS "Item", t."movementType" AS "Type", t.quantity AS "Qty", t."stockAfter" AS "After", t."createdAt" AS "When" FROM stock_movements t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} ORDER BY t."createdAt" DESC LIMIT 60`),
  ],
}));

// ── ENERGY ──────────────────────────────────────────────────────
const ER_W = `${F_JOIN} WHERE $__timeFilter(t."timestamp") AND ${F_WHERE} AND ${M_WHERE}`;
D('energy', mkDash({
  uid: 'mes-energy-overview', title: 'Energy Overview', tags: ['energy'],
  description: 'Consumption, cost and intensity.',
  panels: [
    stat('Total kWh', `SELECT ROUND(COALESCE(SUM(t.value),0)::numeric,1) AS value FROM energy_readings t ${ER_W}`, { unit: 'kwatth', steps: [{ color: 'blue', value: null }] }),
    stat('Peak Demand (kW)', `SELECT ROUND(COALESCE(MAX(t."powerKw"),0)::numeric,1) AS value FROM energy_readings t ${ER_W}`, { unit: 'kwatt', steps: [{ color: 'orange', value: null }] }),
    stat('Avg Power (kW)', `SELECT ROUND(COALESCE(AVG(t."powerKw"),0)::numeric,1) AS value FROM energy_readings t ${ER_W}`, { unit: 'kwatt' }),
    stat('Meters', `SELECT COUNT(*) AS value FROM energy_meters t ${F_JOIN} WHERE ${F_WHERE} AND t."isActive"=true`),
    timeseries('Power Demand (kW)', [pgTarget(`SELECT $__timeGroupAlias(t."timestamp",$__interval), AVG(t."powerKw") AS "kW" FROM energy_readings t ${ER_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 16, unit: 'kwatt' }),
    piechart('Consumption by Meter Type', `SELECT em.type AS metric, SUM(t.value) AS value FROM energy_readings t JOIN energy_meters em ON em.id=t."meterId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."timestamp") AND ${F_WHERE} GROUP BY em.type`, { w: 8 }),
  ],
}));

const energyTypeDash = (uid, title, etype, unit) => mkDash({
  uid, title, tags: ['energy'],
  description: `${title} consumption monitoring.`,
  panels: [
    stat('Total', `SELECT ROUND(COALESCE(SUM(t.value),0)::numeric,1) AS value FROM energy_readings t JOIN energy_meters em ON em.id=t."meterId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."timestamp") AND ${F_WHERE} AND em.type='${etype}'`, { unit, steps: [{ color: 'blue', value: null }] }),
    stat('Meters', `SELECT COUNT(*) AS value FROM energy_meters t ${F_JOIN} WHERE ${F_WHERE} AND t.type='${etype}'`),
    timeseries('Consumption Trend', [pgTarget(`SELECT $__timeGroupAlias(t."timestamp",$__interval), SUM(t.value) AS "${title}" FROM energy_readings t JOIN energy_meters em ON em.id=t."meterId" JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."timestamp") AND ${F_WHERE} AND em.type='${etype}' GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit }),
  ],
});
D('energy', energyTypeDash('mes-energy-electricity', 'Electricity Monitoring', 'ELECTRICAL', 'kwatth'));
D('energy', energyTypeDash('mes-energy-water', 'Water Monitoring', 'WATER', 'm3'));
D('energy', energyTypeDash('mes-energy-air', 'Compressed Air', 'COMPRESSED_AIR', 'm3'));

D('energy', mkDash({
  uid: 'mes-energy-cost', title: 'Utility Cost Analysis', tags: ['energy', 'cost'],
  description: 'Energy cost and energy-per-unit.',
  panels: [
    stat('Energy/Unit (kWh)', `SELECT CASE WHEN SUM(o."totalOutput")>0 THEN ROUND((SELECT COALESCE(SUM(value),0) FROM energy_readings er JOIN factories f2 ON f2.id=er."factoryId" WHERE $__timeFilter(er."timestamp") AND ('$factory'=''  OR f2.code='$factory'))::numeric/NULLIF(SUM(o."totalOutput"),0),3) ELSE 0 END AS value FROM oee_records o JOIN factories f ON f.id=o."factoryId" WHERE $__timeFilter(o."recordDate") AND ('$factory'='' OR f.code='$factory')`, { unit: 'kwatth' }),
    stat('Total kWh', `SELECT ROUND(COALESCE(SUM(t.value),0)::numeric,1) AS value FROM energy_readings t ${ER_W}`, { unit: 'kwatth' }),
    timeseries('Daily Consumption', [pgTarget(`SELECT $__timeGroupAlias(t."timestamp",'1d'), SUM(t.value) AS "kWh" FROM energy_readings t ${ER_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'kwatth' }),
  ],
}));

// ── TRACEABILITY ────────────────────────────────────────────────
D('traceability', mkDash({
  uid: 'mes-trace-genealogy', title: 'Batch Genealogy', tags: ['traceability'],
  description: 'Batch lineage and genealogy links.',
  panels: [
    stat('Genealogy Links', `SELECT COUNT(*) AS value FROM genealogy_links`),
    stat('Trace Events', `SELECT COUNT(*) AS value FROM trace_events t WHERE $__timeFilter(t."performedAt") AND ('$factory'='' OR t."factoryId" IN (SELECT id FROM factories WHERE code='$factory'))`),
    table('Recent Trace Events', `SELECT t."entityType" AS "Entity", t."entityCode" AS "Code", t."eventType" AS "Event", t."performedAt" AS "When" FROM trace_events t WHERE $__timeFilter(t."performedAt") AND ('$factory'='' OR t."factoryId" IN (SELECT id FROM factories WHERE code='$factory')) ORDER BY t."performedAt" DESC LIMIT 60`),
  ],
}));

D('traceability', mkDash({
  uid: 'mes-trace-product', title: 'Product Traceability', tags: ['traceability'],
  description: 'Forward/backward product traceability.',
  panels: [
    stat('Batches', `SELECT COUNT(*) AS value FROM batch_records t ${F_JOIN} WHERE ${F_WHERE}`),
    table('Batch → Order → Product', `SELECT b."batchNumber" AS "Batch", w."orderNumber" AS "WO #", k.name AS "Product", b.status AS "Status", b."startTime" AS "Start" FROM batch_records b JOIN factories f ON f.id=b."factoryId" LEFT JOIN work_orders w ON w.id=b."workOrderId" LEFT JOIN skus k ON k.id=b."skuId" WHERE ${F_WHERE} ORDER BY b."startTime" DESC NULLS LAST LIMIT 60`),
  ],
}));

D('traceability', mkDash({
  uid: 'mes-trace-material', title: 'Material Traceability', tags: ['traceability'],
  description: 'Material lot consumption lineage.',
  panels: [
    stat('Consumptions', `SELECT COUNT(*) AS value FROM material_consumptions t WHERE $__timeFilter(t."consumedAt")`),
    table('Material Consumption', `SELECT mc."consumedAt" AS "When", ml."lotNumber" AS "Lot", ml."materialName" AS "Material", mc."quantityActual" AS "Qty" FROM material_consumptions mc LEFT JOIN material_lots ml ON ml.id=mc."materialLotId" WHERE $__timeFilter(mc."consumedAt") ORDER BY mc."consumedAt" DESC LIMIT 60`),
  ],
}));

D('traceability', mkDash({
  uid: 'mes-trace-recall', title: 'Recall Analysis', tags: ['traceability'],
  description: 'Recall impact assessment by batch/lot.',
  panels: [
    stat('Batches (window)', `SELECT COUNT(*) AS value FROM batch_records t ${F_JOIN} WHERE ${F_WHERE} AND $__timeFilter(t."startTime")`),
    table('Affected Batches', `SELECT b."batchNumber" AS "Batch", k.name AS "Product", b.quantity AS "Qty", b.status AS "Status", b."releaseDate" AS "Released" FROM batch_records b JOIN factories f ON f.id=b."factoryId" LEFT JOIN skus k ON k.id=b."skuId" WHERE ${F_WHERE} AND $__timeFilter(b."startTime") ORDER BY b."startTime" DESC LIMIT 80`),
  ],
}));

// ── IIOT ────────────────────────────────────────────────────────
// Device.status enum = CONNECTED | DISCONNECTED | ERROR (NOT "ONLINE").
D('iiot', mkDash({
  uid: 'mes-iiot-device-health', title: 'Device Health', tags: ['iiot'],
  description: 'Field device connectivity across PLCs, meters, sensors and drives.', refresh: '15s', time: 'now-6h',
  panels: [
    stat('Connected', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND UPPER(t.status)='CONNECTED'`, { steps: [{ color: 'green', value: null }] }),
    stat('Disconnected', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND t."isActive"=true AND UPPER(t.status)='DISCONNECTED'`, { steps: [{ color: 'red', value: null }] }),
    stat('Errored', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND UPPER(t.status)='ERROR'`, { steps: [{ color: 'orange', value: null }] }),
    stat('Total Devices', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE}`),
    piechart('Status Mix', `SELECT t.status AS metric, COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} GROUP BY t.status`, { w: 8 }),
    piechart('By Protocol', `SELECT t.protocol AS metric, COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} GROUP BY t.protocol`, { w: 8 }),
    barchart('By Type', `SELECT t.type AS metric, COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} GROUP BY t.type ORDER BY value DESC`, { w: 8 }),
    table('Device Status', `SELECT t.name AS "Device", t."deviceCode" AS "Code", t.type AS "Type", t.protocol AS "Protocol", t.status AS "Status", t."lastSeenAt" AS "Last Seen" FROM devices t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} ORDER BY t."lastSeenAt" DESC NULLS LAST LIMIT 60`),
  ],
}));

// Real edge gateways live in the `gateways` table (status ONLINE|OFFLINE|ERROR + heartbeat).
D('iiot', mkDash({
  uid: 'mes-iiot-gateway', title: 'Gateway Status', tags: ['iiot'],
  description: 'Edge gateway fleet — heartbeat, version and the devices each polls.', refresh: '15s',
  panels: [
    stat('Gateways Online', `SELECT COUNT(*) AS value FROM gateways g JOIN factories f ON f.id=g."factoryId" WHERE ${"('$factory' = '' OR f.code = '$factory')"} AND g."isActive"=true AND UPPER(g.status)='ONLINE'`, { steps: [{ color: 'green', value: null }] }),
    stat('Offline / Error', `SELECT COUNT(*) AS value FROM gateways g JOIN factories f ON f.id=g."factoryId" WHERE ${"('$factory' = '' OR f.code = '$factory')"} AND g."isActive"=true AND UPPER(g.status)<>'ONLINE'`, { steps: [{ color: 'red', value: null }] }),
    stat('Polled Devices', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND t."gatewayId" IS NOT NULL`, { steps: [{ color: 'blue', value: null }] }),
    table('Edge Gateways', `SELECT g.name AS "Gateway", g.hostname AS "Host", g.version AS "Version", g.status AS "Status", g."lastHeartbeatAt" AS "Last Heartbeat", (SELECT COUNT(*) FROM devices d WHERE d."gatewayId"=g.id) AS "Devices" FROM gateways g JOIN factories f ON f.id=g."factoryId" WHERE ${"('$factory' = '' OR f.code = '$factory')"} ORDER BY g.name LIMIT 60`),
  ],
}));

// No mosquitto Prometheus exporter is provisioned → drive MQTT monitoring from what we
// actually persist: MQTT-protocol devices, edge-gateway heartbeats and live tag ingestion.
D('iiot', mkDash({
  uid: 'mes-iiot-mqtt', title: 'MQTT Monitoring', tags: ['iiot', 'mqtt'],
  description: 'MQTT edge connectivity and tag ingestion (devices, gateways, live tags).', refresh: '15s', time: 'now-3h',
  panels: [
    stat('MQTT Devices', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND UPPER(t.protocol)='MQTT'`, { steps: [{ color: 'blue', value: null }] }),
    stat('MQTT Connected', `SELECT COUNT(*) AS value FROM devices t ${F_JOIN} WHERE ${F_WHERE} AND UPPER(t.protocol)='MQTT' AND UPPER(t.status)='CONNECTED'`, { steps: [{ color: 'green', value: null }] }),
    stat('Gateways Online', `SELECT COUNT(*) AS value FROM gateways g JOIN factories f ON f.id=g."factoryId" WHERE ${"('$factory' = '' OR f.code = '$factory')"} AND UPPER(g.status)='ONLINE'`, { steps: [{ color: 'green', value: null }] }),
    stat('Tags Updated (5m)', `SELECT COUNT(*) AS value FROM tag_current_values WHERE "timestamp" > NOW()-INTERVAL '5 minutes'`, { steps: [{ color: 'green', value: null }] }),
    timeseries('Tag Ingestion Rate (updates/interval)', [pgTarget(`SELECT $__timeGroupAlias(tcv."timestamp",$__interval), COUNT(*) AS "Updates" FROM tag_current_values tcv WHERE $__timeFilter(tcv."timestamp") GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24 }),
    table('MQTT Devices & Last Seen', `SELECT t.name AS "Device", t."deviceCode" AS "Code", t.status AS "Status", t."lastSeenAt" AS "Last Seen", t."lastError" AS "Last Error" FROM devices t JOIN factories f ON f.id=t."factoryId" WHERE ${F_WHERE} AND UPPER(t.protocol)='MQTT' ORDER BY t."lastSeenAt" DESC NULLS LAST LIMIT 50`),
  ],
}));

// Live process telemetry is historized to InfluxDB measurement "tag" (field "value",
// tag key "tagCode"); current values are mirrored to Postgres tag_current_values.
D('iiot', mkDash({
  uid: 'mes-iiot-sensor', title: 'Sensor Analytics', tags: ['iiot'],
  description: 'Live tag values and historized process telemetry.', refresh: '15s', time: 'now-3h',
  panels: [
    stat('Active Tags', `SELECT COUNT(*) AS value FROM tag_current_values`),
    stat('Historized Tags', `SELECT COUNT(*) AS value FROM tag_definitions t ${F_JOIN} WHERE ${F_WHERE} AND t."historizationEnabled"=true`, { steps: [{ color: 'blue', value: null }] }),
    influxPanel('Process Telemetry (InfluxDB · measurement "tag")', `from(bucket: "mes_timeseries")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r._measurement == "tag" and r._field == "value")\n  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)\n  |> keep(columns: ["_time", "_value", "tagCode"])`, { w: 24 }),
    table('Latest Tag Values', `SELECT td.name AS "Tag", td.code AS "Code", tcv.value AS "Value", td.unit AS "Unit", tcv."timestamp" AS "Updated" FROM tag_current_values tcv JOIN tag_definitions td ON td.id=tcv."tagId" ORDER BY tcv."timestamp" DESC LIMIT 60`),
  ],
}));

// ── EXECUTIVE ───────────────────────────────────────────────────
D('executive', mkDash({
  uid: 'mes-exec-cockpit', title: 'Executive Manufacturing Cockpit', tags: ['executive'],
  description: 'Single-screen plant performance.',
  panels: [
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    stat('Output', `SELECT COALESCE(SUM("totalOutput"),0) AS value FROM oee_records t ${OEE_W}`, { steps: [{ color: 'green', value: null }] }),
    stat('FPY %', `SELECT CASE WHEN SUM("totalOutput")>0 THEN ROUND(100.0*SUM("goodOutput")/SUM("totalOutput"),1) ELSE 0 END AS value FROM oee_records t ${OEE_W}`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Open NCRs', `SELECT COUNT(*) AS value FROM ncrs t ${NCR_W} AND t.status NOT IN ('RESOLVED','CLOSED')`, { steps: [{ color: 'orange', value: null }] }),
    stat('Open Maint. WOs', `SELECT COUNT(*) AS value FROM maintenance_wos t ${MWO} AND t.status IN ('OPEN','ASSIGNED','IN_PROGRESS')`, { steps: [{ color: 'orange', value: null }] }),
    stat('Reorder Alerts', `SELECT COUNT(*) AS value FROM raw_materials t ${F_JOIN} WHERE ${F_WHERE} AND t."currentStock" < COALESCE(t."reorderPoint",t."minStock")`, { steps: [{ color: 'red', value: null }] }),
    timeseries('OEE Trend (all factories)', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'percent' }),
  ],
}));

D('executive', mkDash({
  uid: 'mes-exec-factory-compare', title: 'Factory Comparison', tags: ['executive'],
  description: 'Side-by-side factory KPIs.',
  panels: [
    barchart('OEE by Factory', `SELECT f.name AS metric, ROUND(AVG(t.oee)::numeric,1) AS value FROM oee_records t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") GROUP BY f.name ORDER BY value DESC`, { w: 12, unit: 'percent' }),
    barchart('Output by Factory', `SELECT f.name AS metric, SUM(t."totalOutput") AS value FROM oee_records t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") GROUP BY f.name ORDER BY value DESC`, { w: 12 }),
    table('Factory Scorecard', `SELECT f.name AS "Factory", ROUND(AVG(t.oee)::numeric,1) AS "OEE %", ROUND(AVG(t.availability)::numeric,1) AS "Avail %", ROUND(AVG(t.quality)::numeric,1) AS "Quality %", SUM(t."totalOutput") AS "Output" FROM oee_records t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") GROUP BY f.name ORDER BY 2 DESC`),
  ],
}));

D('executive', mkDash({
  uid: 'mes-exec-multiplant', title: 'Multi-Plant Performance', tags: ['executive'],
  description: 'Enterprise-wide trend across plants.',
  panels: [
    timeseries('OEE by Factory (trend)', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), f.name AS metric, AVG(t.oee) AS value FROM oee_records t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") GROUP BY 1, f.name ORDER BY 1`, 'time_series')], { w: 24, unit: 'percent' }),
    timeseries('Output by Factory (trend)', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), f.name AS metric, SUM(t."totalOutput") AS value FROM oee_records t JOIN factories f ON f.id=t."factoryId" WHERE $__timeFilter(t."recordDate") GROUP BY 1, f.name ORDER BY 1`, 'time_series')], { w: 24 }),
  ],
}));

D('executive', mkDash({
  uid: 'mes-exec-corporate-kpi', title: 'Corporate KPI Dashboard', tags: ['executive', 'kpi'],
  description: 'Corporate KPI rollup across all domains.',
  panels: [
    stat('Avg OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t WHERE $__timeFilter(t."recordDate")`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Total Output', `SELECT COALESCE(SUM("totalOutput"),0) AS value FROM oee_records t WHERE $__timeFilter(t."recordDate")`, { steps: [{ color: 'green', value: null }] }),
    stat('FPY %', `SELECT CASE WHEN SUM("totalOutput")>0 THEN ROUND(100.0*SUM("goodOutput")/SUM("totalOutput"),1) ELSE 0 END AS value FROM oee_records t WHERE $__timeFilter(t."recordDate")`, { unit: 'percent', steps: OEE_STEPS }),
    stat('Open NCRs', `SELECT COUNT(*) AS value FROM ncrs t WHERE t.status NOT IN ('RESOLVED','CLOSED')`, { steps: [{ color: 'orange', value: null }] }),
    stat('Open Maint.', `SELECT COUNT(*) AS value FROM maintenance_wos t WHERE t.status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND t."deletedAt" IS NULL`, { steps: [{ color: 'orange', value: null }] }),
    stat('Energy kWh', `SELECT ROUND(COALESCE(SUM(t.value),0)::numeric,0) AS value FROM energy_readings t WHERE $__timeFilter(t."timestamp")`, { unit: 'kwatth' }),
    table('Per-Factory Rollup', `SELECT f.name AS "Factory", ROUND(AVG(o.oee)::numeric,1) AS "OEE %", SUM(o."totalOutput") AS "Output", (SELECT COUNT(*) FROM ncrs n WHERE n."factoryId"=f.id AND n.status NOT IN ('RESOLVED','CLOSED')) AS "Open NCRs", (SELECT COUNT(*) FROM maintenance_wos mw WHERE mw."factoryId"=f.id AND mw.status IN ('OPEN','ASSIGNED','IN_PROGRESS') AND mw."deletedAt" IS NULL) AS "Open Maint" FROM oee_records o JOIN factories f ON f.id=o."factoryId" WHERE $__timeFilter(o."recordDate") GROUP BY f.id, f.name ORDER BY 2 DESC`),
  ],
}));

// ── TEMPLATES ───────────────────────────────────────────────────
D('templates', mkDash({
  uid: 'mes-tpl-line-performance', title: 'TEMPLATE — Line Performance', tags: ['template'],
  description: 'Reusable per-line performance template. Clone and adapt.',
  panels: [
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    stat('Output', `SELECT COALESCE(SUM("totalOutput"),0) AS value FROM oee_records t ${OEE_W}`, { steps: [{ color: 'green', value: null }] }),
    timeseries('OEE Trend', [pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series')], { w: 24, unit: 'percent' }),
  ],
}));

D('templates', mkDash({
  uid: 'mes-tpl-machine-detail', title: 'TEMPLATE — Machine Detail', tags: ['template'],
  description: 'Reusable single-machine deep-dive template.',
  panels: [
    gauge('OEE', `SELECT COALESCE(AVG(oee),0) AS value FROM oee_records t ${OEE_W}`, { steps: OEE_STEPS }),
    stat('Downtime (min)', `SELECT COALESCE(SUM(t."durationMinutes"),0) AS value FROM downtime_events t ${DT_W}`, { unit: 'm', steps: BAD_HIGH }),
    stat('Output', `SELECT COALESCE(SUM("totalOutput"),0) AS value FROM oee_records t ${OEE_W}`, { steps: [{ color: 'green', value: null }] }),
    timeseries('Machine OEE & Downtime', [
      pgTarget(`SELECT $__timeGroupAlias(t."recordDate",$__interval), AVG(oee) AS "OEE %" FROM oee_records t ${OEE_W} GROUP BY 1 ORDER BY 1`, 'time_series', 'A'),
    ], { w: 24, unit: 'percent' }),
  ],
}));

D('templates', mkDash({
  uid: 'mes-tpl-blank-factory', title: 'TEMPLATE — Blank Factory-Aware', tags: ['template'],
  description: 'Empty starting point with all MES360° factory-context variables wired. Clone to build a new dashboard.',
  panels: [
    stat('Factories', `SELECT COUNT(*) AS value FROM factories WHERE "isActive"=true`),
    table('Add your panels here', `SELECT 'Use $factory, $area, $line, $machine, $shift, $product, $batch in your queries' AS "Hint"`),
  ],
}));

// =================================================================
// EMIT
// =================================================================
let count = 0;
for (const { folder, def } of DASHBOARDS) {
  const dir = join(OUT, folder);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${def.uid}.json`);
  writeFileSync(file, JSON.stringify(def, null, 2) + '\n', 'utf8');
  count++;
}
console.log(`✅ Generated ${count} dashboards across ${new Set(DASHBOARDS.map(d => d.folder)).size} folders → ${OUT}`);
