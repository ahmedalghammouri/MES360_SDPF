# MES360° — 1-Week Final Sprint (PoC-Aligned)
**Project:** MES360° Platform — NCC / SIDCO PoC, Dammam
**Sprint:** Mon 2026-06-08 → Mon 2026-06-15 · **Target:** 100% PoC Complete
**Scope Reference:** PoC Proposal v2 + NCC Prerequisites File

---

## SCOPE ALIGNMENT (PoC Proposal v2)

| PoC Layer | Status | Maps To |
|-----------|--------|---------|
| Layer 01 — DAQ / SCADA / IIoT | ✅ IN SCOPE | Module 14 (IIoT & Connectivity) |
| Layer 02 — MES Platform | ✅ IN SCOPE | Modules 1–13, 15–18 |
| Layer 03 — Simulation & Optimization | ❌ OUT OF POC SCOPE | — deferred to Phase 2 |
| Layer 04 — AI & Intelligence | ❌ OUT OF POC SCOPE | — deferred to Phase 2 |
| ERP / SAP Integration | ❌ OUT OF POC SCOPE | — deferred |
| Email SMTP Service | ⚠️ NOT A MODULE — alert channel config only (part of #13) |
| Security Hardening | ⚠️ POST-POC — production deployment concern, not PoC deliverable |

---

## MODULE STATUS BOARD (20 PoC-Core Modules)

| # | Module | PoC Layer | Current State | Done % | Remaining Work | Day |
|---|--------|-----------|--------------|:------:|----------------|-----|
| 1 | **Production Orders (ISA-95)** | MES | PO CRUD + release + auto-generate WOs | **92%** | E2E tests; status-transition edge guards | Mon 8 |
| 2 | **Work Orders** | MES | State machine, OEE, counts, inspection panel | **90%** | Downtime auto-link on WO hold; WebSocket state-change event | Mon 8 |
| 3 | **Production Scheduling** | MES | PO→WO hierarchy view, expandable rows | **88%** | Gantt timeline bars with visual date positioning | Mon 8 |
| 4 | **Quality — Plans & Inspections** | MES | Plans CRUD, inspection from WO, SPC chart | **90%** | Inspection edit/delete; parameter-level pass/fail detail | Tue 9 |
| 5 | **Quality — NCR & CAPA** | MES | NCR full CRUD, CAPA + actions UI | **78%** | CAPA effectiveness review; NCR→CAPA auto-link; close checklist | Tue 9 |
| 6 | **Quality — SPC Charts** | MES | 14 pts, UCL/LCL, out-of-control flags | **82%** | Real-time update from inspection save; Western Electric rule annotations | Tue 9 |
| 7 | **Maintenance — Work Orders (CMMS)** | MES | List, create, state machine UI | **72%** | Close flow with spare-parts-used + labor hours; PDF work order card | Wed 10 |
| 8 | **Maintenance — PM & Assets** | MES | PM schedule list, assets list | **70%** | PM due-date alert; asset history timeline; next-service countdown | Wed 10 |
| 9 | **Inventory — SKU / BOM / Lots** | MES | SKUs, BOM, raw materials, lots, storage, spares | **85%** | Stock movement transactions (issue to WO, receive from PO); low-stock badge | Wed 10 |
| 10 | **Downtime Management** | MES | Events list, manual log, causes tree | **75%** | Auto-close endpoint; Pareto chart; filter by shift; export CSV | Thu 11 |
| 11 | **Reports & Analytics** | MES | Production/Quality/Maintenance view shells | **42%** | Aggregated data queries; date-range picker; PDF/Excel export (PoC deliverable!) | Thu 11 |
| 12 | **Energy Module (EMS)** | MES | Meters list, overview KPIs | **60%** | Meter readings CRUD; consumption trend chart; shift-level breakdown | Thu 11 |
| 13 | **Notifications & Alert Channels** | MES | In-app notifs, rules seed, bell counter | **70%** | Rules management UI; email alert channel (nodemailer — config only); in-app alert on thresholds | Fri 12 |
| 14 | **IIoT & Connectivity** | DAQ Layer 01 | Devices/Tags/Drivers/Streams UI shells | **50%** | MQTT live subscription demo (simulated PLC); live tag polling; device heartbeat; port 1883 validation | Fri 12 |
| 15 | **Traceability** | MES | Basic forward/backward trace | **30%** | Full lot genealogy (RM→WO→Batch→Dispatch); QR scan input; NCR cross-link | Fri 12 |
| 16 | **Users & Roles** | Platform | List, create, role assign, password reset | **78%** | Seed NCC real users (Issa/Mohammed/Mohammed.Yousef); permission matrix view; audit log | Sat 13 |
| 17 | **Settings & Configuration** | Platform | Settings page shell | **32%** | Factory config: shifts (07:30–19:30 / 19:30–07:30), targets (3000–3500/shift), timezone, break times | Sat 13 |
| 18 | **Dashboard (OEE / Live KPIs)** | MES | Live KPIs, OEE gauge, WO table, downtime feed | **87%** | WebSocket push for KPI cards; shift heatmap; top-5 downtime Pareto bar (PoC deliverable!) | Sun 14 |
| 19 | **Infrastructure & DevOps** | Infra | Docker Compose, CI/CD, Prometheus, Grafana | **72%** | k6 load test (50 users); pg_dump→MinIO backup cron; health-check endpoints | Sun 14 |
| 20 | **QA + NCC Demo Data + Go-Live** | QA | PoC seed data loaded | **65%** | Load real NCC data (SKUs, machines, shifts, cycle times, downtime causes); full regression; demo script | Mon 15 |

**Overall: ~70% → Target: 100%**

---

## DEFERRED (OUT OF POC SCOPE)

| Module | Reason | Proposed Phase |
|--------|--------|---------------|
| AI Intelligence (anomaly detection, prediction) | Explicitly out of scope in PoC Proposal v2 — Layer 04 | Phase 2 |
| Email SMTP (nodemailer EmailService) | Not a standalone PoC module — basic alert config folded into #13 | Phase 2 |
| Security Hardening (SSL, secret rotation) | Post-PoC production deployment concern | Phase 2 |
| WhatsApp Business API webhook | Not in PoC scope — noted as "future" alert channel | Phase 2 |
| ERP/SAP Integration | Explicitly out of PoC scope | Phase 2 |
| Simulation / Digital Twin | Layer 03 — out of PoC scope | Phase 3 |

---

## DAILY SCHEDULE

```
DATE        FOCUS                           MODULES     TARGET %
────────────────────────────────────────────────────────────────
Mon Jun 08  Production completion           1 · 2 · 3   → 98%
Tue Jun 09  Quality full coverage           4 · 5 · 6   → 92%
Wed Jun 10  Maintenance + Inventory         7 · 8 · 9   → 90%
Thu Jun 11  Downtime · Reports · Energy     10 · 11 · 12 → 80%
Fri Jun 12  IIoT · Notifications · Trace   13 · 14 · 15 → 75%
Sat Jun 13  Users · Settings               16 · 17      → 95%
Sun Jun 14  Dashboard · DevOps             18 · 19      → 95%
Mon Jun 15  QA · NCC Demo Data · Go-live   20           → 100%
```

---

## NCC DEMO DATA CHECKLIST (from Prerequisites File)

These must be loaded before the NCC demo day (Jun 15):

- [ ] **5 Machines:** Big Betti, Cartomac, Checkweigher, Euro-Pack Robot, Uni-tech Wrapping
- [ ] **Cycle times:** Big Betti 30-35s / Cartomac 25-40s / Euro-Pack 4m50s–7m50s / Uni-tech 2m25s–2m50s
- [ ] **SKUs:** 30+ GENTO, Safe, Alwatani, Rex, Miza (Panda) variants with actual NCC SKU codes (10310064–10310298)
- [ ] **2 Shifts:** Shift 1 07:30–19:30, Shift 2 19:30–07:30, breaks 0.5h each, 11h planned production
- [ ] **Target:** 3000–3500 boxes per shift; downtime threshold = 1 minute
- [ ] **Downtime causes per machine:** Big Betti (17 causes), Cartomac (14 causes), Euro-Pack Robot (8 causes)
- [ ] **Real users:** Issa Masadeh (Admin), Mohammed Brakat (Manager), Mohammed Yousef (Supervisor)
- [ ] **Alert channels:** email to issa.masadeh@sidco.com.sa, mohammed.brakat@sidco.com.sa, mohammed.yousef@sidco.com.sa

---

## COMPLETION SUMMARY

| Category | Modules | Avg % Now | Target Jun 15 | Gap |
|----------|---------|:---------:|:-------------:|:---:|
| Production | 1 · 2 · 3 | 90% | 100% | 10% |
| Quality | 4 · 5 · 6 | 83% | 100% | 17% |
| Maintenance / CMMS | 7 · 8 | 71% | 100% | 29% |
| Inventory | 9 | 85% | 100% | 15% |
| Downtime & Energy | 10 · 12 | 68% | 100% | 32% |
| Analytics (PoC deliverable) | 11 | 42% | 100% | 58% |
| IIoT & Traceability | 14 · 15 | 40% | 90% | 50% |
| Notifications | 13 | 70% | 100% | 30% |
| Users & Settings | 16 · 17 | 55% | 100% | 45% |
| Dashboard & DevOps | 18 · 19 · 20 | 75% | 100% | 25% |
| **TOTAL** | **20 tasks** | **70%** | **100%** | **30%** |

---

## PRIORITY FLAGS

| Module | Flag | Basis |
|--------|------|-------|
| NCR → CAPA flow (#5) | 🔴 BLOCKER | Core quality completeness; incomplete close loop |
| Reports & Analytics (#11) | 🔴 BLOCKER | "Executive Analytics Report" is explicit PoC deliverable (PoC Proposal v2) |
| IIoT & Connectivity (#14) | 🔴 BLOCKER | DAQ/SCADA is Layer 01 of PoC — the hardware layer the PoC is built on |
| Maintenance WO close (#7) | 🟠 HIGH | CMMS is explicit Layer 02 PoC scope |
| Notifications alerting (#13) | 🟠 HIGH | "Automated Alerting System" is explicit PoC deliverable (PoC Proposal v2) |
| Traceability lot genealogy (#15) | 🟠 HIGH | Batch/Lot tracking in Requirements Matrix (all factories) |
| Downtime Pareto (#10) | 🟡 MEDIUM | Improves PoC demo — NCC provided their 30+ downtime causes |
| Energy readings CRUD (#12) | 🟡 MEDIUM | EMS (Energy Platform) is Layer 02 PoC scope |
| Settings (shifts/targets) (#17) | 🟡 MEDIUM | NCC provided exact shift times and targets — must reflect in system |
| Gantt timeline bars (#3) | 🟢 NICE | Visual polish for scheduling view |
| Western Electric SPC rules (#6) | 🟢 NICE | Advanced SPC — basic rules already working |

---

## DEFINITION OF DONE

A module is 100% complete when:
1. **Backend** — all CRUD + status endpoints exist, validated, correct HTTP codes
2. **Frontend** — list, create/edit, delete, status actions all work
3. **Data** — seed data covers every status/scenario in the UI
4. **Error states** — empty states, skeletons, API error toasts render correctly
5. **Permissions** — RBAC enforced (OPERATOR read-only, FACTORY_ADMIN full control)
6. **Responsive** — layout intact at 768px (tablet for shop floor)
7. **No console errors** in DevTools during normal use

---

*Last updated: 2026-06-08 · Scope basis: PoC Proposal v2 + NCC Prerequisites File · Next review: 2026-06-11*
