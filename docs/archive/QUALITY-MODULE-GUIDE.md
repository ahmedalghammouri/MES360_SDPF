# Quality Module — Workflow & Integration Guide

**Standard:** ISA-95 Part 3 — Manufacturing Operations Management  
**Platform:** MES360°  
**Last Updated:** 2026-06-08

---

## Table of Contents

1. [Overview & ISA-95 Data Model](#1-overview--isa-95-data-model)
2. [Quality Module Pages](#2-quality-module-pages)
3. [Step-by-Step: Setting Up Quality Plans](#3-step-by-step-setting-up-quality-plans)
4. [Step-by-Step: Running Inspections with Work Orders](#4-step-by-step-running-inspections-with-work-orders)
5. [Manufacturing Process Integration](#5-manufacturing-process-integration)
6. [NCR & CAPA Workflow](#6-ncr--capa-workflow)
7. [SPC — Statistical Process Control](#7-spc--statistical-process-control)
8. [ISA-95 Data Flow Diagram](#8-isa-95-data-flow-diagram)
9. [Quick Reference — Field Definitions](#9-quick-reference--field-definitions)
10. [Common Scenarios & Examples](#10-common-scenarios--examples)

---

## 1. Overview & ISA-95 Data Model

The Quality Module is built to the **ISA-95 Part 3** standard, which defines how quality information flows between enterprise systems (ERP) and the manufacturing floor (MES).

### Core ISA-95 Objects Used

| ISA-95 Term | MES360° Object | Description |
|---|---|---|
| `QualityTestSpecification` | **Quality Plan** | Defines WHAT to test and acceptable limits |
| `QualityTestSpecificationProperty` | **Quality Parameter / Check Point** | Individual measurement with UCL/LCL/USL/LSL |
| `QualityTestResult` | **Inspection Result** | Actual measurement taken during/after production |
| `ProductionRequest` | **Work Order** | Links inspection to a specific production run |
| `MaterialLot` | **Material Lot** | Traceable lot of raw material or finished product |
| `NonConformanceReport` | **NCR** | Records a quality failure and its disposition |
| `CorrectiveAction` | **CAPA** | Root-cause corrective and preventive actions |

### Three Inspection Types (ISA-95 Check Types)

```
INCOMING     — Inspect materials when they arrive at goods receiving
IN_PROCESS   — Inspect during active manufacturing (line-side checks)
FINAL        — Inspect finished product before it leaves the factory
```

### Limit Types Explained

```
UCL / LCL  — Upper/Lower CONTROL Limit   → Set from SPC data (3-sigma from process mean)
USL / LSL  — Upper/Lower SPEC Limit      → Set from product specification / customer requirement

Zone between UCL–USL and LCL–LSL = Warning zone (in-spec but process drifting)
Outside USL/LSL = Non-conforming → triggers NCR
Outside UCL/LCL = Process out of statistical control → SPC alert
```

---

## 2. Quality Module Pages

Navigate to **Quality** in the left sidebar. The module has six pages:

| Page | Path | Purpose |
|---|---|---|
| Overview | `/quality` | KPI dashboard — FPY, open NCRs, CAPA compliance, SPC |
| **Quality Plans** | `/quality/plans` | Configure check types, check points, SPC limits |
| Inspections | `/quality/inspections` | Log and review all inspection results |
| Non-Conformance | `/quality/ncr` | Raise and manage NCRs |
| CAPA | `/quality/capa` | Corrective and preventive action register |
| SPC Charts | `/quality/spc` | Statistical Process Control charts |

---

## 3. Step-by-Step: Setting Up Quality Plans

A **Quality Plan** is the master template that defines what gets inspected. You must set up at least one plan before you can run inspections linked to production.

### 3.1 Create a Quality Plan

1. Go to **Quality → Quality Plans**
2. Click **New Plan**
3. Fill in the form:

| Field | Description | Example |
|---|---|---|
| Plan Code | Unique identifier (auto-uppercased) | `QP-RM-001` |
| Check Type | When this plan is used | `INCOMING` |
| Plan Name | Human-readable name | `Raw Material Incoming Inspection` |
| Sampling Frequency | How often to inspect | `EVERY_BATCH` |
| Sample Qty | How many units to sample | `5` |
| Version | Plan version for change control | `1.0` |

4. Click **Create Plan** — the plan is created in **Draft** status.

> **Check Types:**
> - `INCOMING` — Use for raw material receipts, goods-in inspection
> - `IN_PROCESS` — Use for line-side quality checks during active work orders
> - `FINAL` — Use for finished product inspection before dispatch

### 3.2 Add Check Points (Quality Parameters)

After creating the plan, click it to open the detail panel, then click **Add Parameter**.

Each check point represents one measurable characteristic:

| Field | Required | Description | Example |
|---|---|---|---|
| Parameter Name | Yes | What is being measured | `Fill Weight` |
| Unit | No | Unit of measurement | `g` |
| Nominal Value | No | Target / ideal value | `500` |
| UCL | No | Upper Control Limit (SPC) | `510` |
| LCL | No | Lower Control Limit (SPC) | `490` |
| USL | No | Upper Specification Limit | `515` |
| LSL | No | Lower Specification Limit | `485` |
| Check Method | No | How to perform the check | `Weigh on calibrated balance` |
| KPI Parameter | No | Mark as a Key Performance Indicator | `☑` |

**Limits hierarchy:**

```
                    LSL                         USL
                     |                           |
          ←  Reject  |  LCL               UCL   |  Reject  →
                     |   |                 |    |
                     |   |   GOOD ZONE     |    |
                     |   |                 |    |
                   485  490      500      510  515

                   LSL  LCL   NOMINAL     UCL  USL
```

- Values **outside LSL/USL** → FAIL → triggers NCR
- Values **outside LCL/UCL** but inside LSL/USL → CONDITIONAL (process drifting, investigate)
- Values **inside UCL/LCL** → PASS

### 3.3 Approve the Plan

Quality plans must be approved before they are considered active for production:

1. Click the **Approve** button in the plan card or detail sheet
2. The plan status changes from **Pending Approval** to **Approved**
3. Approved plans can be selected when logging inspections

> Only approved plans should be used for production inspections. Draft plans are for configuration only.

### 3.4 Plan Naming Convention (Recommended)

```
QP-{TYPE}-{PRODUCT/LINE}-{SEQ}

Examples:
  QP-RM-SUGAR-001     → Incoming inspection for sugar raw material
  QP-IP-LINE2-001     → In-process check for Line 2
  QP-FN-BETTI2L-001   → Final inspection for Betti 2L product
```

---

## 4. Step-by-Step: Running Inspections with Work Orders

### 4.1 ISA-95 Linkage

Every inspection can be linked to:
- A **Work Order** → ties the quality result to a specific production run
- A **Quality Plan** → loads the check-point checklist automatically
- A **Machine** → records which equipment produced the lot
- A **Batch Record** → full traceability from raw material to finished product

### 4.2 Logging an In-Process Inspection (During Production)

**Scenario:** Work Order `WO-2026-0042` is running on Line 2. The quality engineer needs to log a mid-shift inspection.

1. Go to **Production → Work Orders**
2. Click the work order row to open the detail panel
3. Scroll down to the **Quality Inspections** section — all previous inspections for this WO are listed here
4. Go to **Quality → Inspections**
5. Click **New Inspection**
6. Fill the form:

| Field | Value | Notes |
|---|---|---|
| Type | `IN_PROCESS` | Mid-production check |
| Quality Plan | `QP-IP-LINE2-001` | Select the matching plan |
| Work Order | `WO-2026-0042` | Links this inspection to the WO |
| Total Qty | `50` | Samples inspected |
| Pass Qty | `48` | Units that passed |
| Fail Qty | `2` | Units that failed |

7. After selecting the Quality Plan, the **Quality Check Points** section appears automatically with all parameters from the plan
8. For each parameter, enter:
   - **Measured Value** — the actual reading taken
   - **Pass / Fail** — tap the button to record the result
   - **Notes** — any observations

9. Click **Save Inspection**

The system automatically:
- Calculates overall result: `PASS` (≥ 95% pass rate), `CONDITIONAL` (80–95%), `FAIL` (< 80%)
- Links the record to the Work Order
- Stores all individual measurements for SPC analysis

### 4.3 Viewing Quality Results on a Work Order

1. Go to **Production → Work Orders**
2. Click any work order
3. The right-side detail panel shows a **Quality** section with:
   - All inspections run for this WO
   - Pass/fail counts per inspection
   - Result badge (PASS / FAIL / CONDITIONAL)
   - Linked quality plan name
   - Inspector name and date/time

### 4.4 Logging an Incoming Inspection (Goods Receipt)

**Scenario:** A delivery of raw sugar arrives. The store manager needs to inspect and accept/reject the lot.

1. Go to **Quality → Inspections → New Inspection**
2. Set Type to `INCOMING`
3. Select the plan `QP-RM-SUGAR-001`
4. Fill quantities and check points
5. If the result is **FAIL**, the system will prompt you to raise an NCR

Alternatively, link incoming inspections to a **Material Lot** (from `Inventory → Material Lots`) for full ISA-95 traceability.

### 4.5 Logging a Final Inspection (Before Dispatch)

**Scenario:** Finished Betti 2L pallets are ready for dispatch. Quality sign-off is required.

1. Create an inspection with Type `FINAL`
2. Link to the Work Order that produced these pallets
3. Select the final inspection plan `QP-FN-BETTI2L-001`
4. Enter measurements for all check points
5. If result is `PASS`, the batch is cleared for dispatch
6. If result is `FAIL` or `CONDITIONAL`, raise an NCR before releasing

---

## 5. Manufacturing Process Integration

The quality module is wired into the production manufacturing process at three levels:

### 5.1 Quality Gates in Work Order Lifecycle

```
Work Order Status Flow:
PLANNED → RELEASED → IN_PROGRESS → QUALITY_CHECK → COMPLETED
                                         ↑
                              Inspection result required
```

During the `IN_PROGRESS` phase:
- Operators/quality engineers can log **IN_PROCESS** inspections at any point
- The Work Order detail panel shows a live quality status badge

At the `QUALITY_CHECK` phase (before marking COMPLETED):
- A **FINAL** inspection should be logged
- If the inspection fails → Work Order cannot proceed to COMPLETED until an NCR is raised

### 5.2 Linking Quality Plans to SKUs

Each Quality Plan can optionally be linked to a **SKU (Product)**. This means:
- When a Work Order is created for that SKU, the correct inspection plan is automatically suggested
- Historical inspection data can be filtered by product
- CPK calculations in SPC are product-specific

To link a plan to a SKU: Edit the Quality Plan → enter the SKU ID in the configuration.

### 5.3 Linking Quality Plans to Machines

When a Quality Plan is linked to a specific **Machine**:
- In-process inspections are automatically associated with that machine
- SPC measurements appear on the machine's control chart
- Out-of-control events can trigger maintenance alerts

### 5.4 Batch Traceability

Every inspection can be linked to a **Batch Record**, creating a full ISA-95 traceability chain:

```
Material Lot (incoming RM)
    ↓
Work Order (production)
    ↓
Batch Record (production run details)
    ↓
Inspection Result (quality check)
    ↓
NCR (if failed) → CAPA (corrective action)
    ↓
Finished Product Lot (outgoing)
```

Access full traceability from **Traceability** in the sidebar.

---

## 6. NCR & CAPA Workflow

### 6.1 When to Raise an NCR

Raise a Non-Conformance Report when:
- An inspection result is `FAIL`
- An operator finds a defect during production
- A customer complaint is received
- An audit finds a process deviation

### 6.2 NCR Required Fields

| Field | Description |
|---|---|
| Title | Short description of the non-conformance |
| Severity | `MINOR` / `MAJOR` / `CRITICAL` |
| Defect Category | Category code (e.g., `LABELING`, `FILL_WEIGHT`, `SEAL`) |
| Non-Conforming Quantity | Number of units affected |
| Description | Detailed description — minimum 10 characters |
| Detected At | Date/time the defect was found |
| Resolution Due Date | Deadline to resolve the issue |
| Machine | Which machine produced the defect (optional) |

### 6.3 NCR Status Workflow

```
OPEN
  │
  ├─ Under Investigation
  │
  ▼
IN_REVIEW
  │
  ├─ Root cause being analyzed
  │
  ▼
CAPA_PENDING
  │
  ├─ Root cause confirmed, CAPA raised
  │
  ▼
RESOLVED
  │
  ├─ Fix implemented and verified
  │
  ▼
CLOSED
```

**Status Transition Rules:**
- `OPEN → IN_REVIEW` — assigned to quality engineer for investigation
- `IN_REVIEW → CAPA_PENDING` — root cause identified, create a CAPA
- `CAPA_PENDING → RESOLVED` — corrective action implemented
- `RESOLVED → CLOSED` — verified effective, no recurrence

### 6.4 Creating a CAPA from an NCR

1. Open the NCR from **Quality → Non-Conformance**
2. Click **Add CAPA**
3. Fill the CAPA form:

| Field | Description |
|---|---|
| Type | `CORRECTIVE` (fix the root cause) or `PREVENTIVE` (prevent similar issues) |
| Title | Brief description of the action |
| Description | Detailed action plan |
| Priority | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` |
| Assigned To | Person responsible for implementing the action |
| Due Date | Deadline for completion |

4. Add action items (sub-tasks) to the CAPA — each with assignee, due date, and evidence requirement
5. As actions are completed, mark them complete with evidence notes
6. Once all actions are complete → click **Submit for Verification**
7. Quality Manager reviews and clicks **Verify Effectiveness**
8. If effective → **Close CAPA**

---

## 7. SPC — Statistical Process Control

### 7.1 What SPC Does

SPC monitors the statistical stability of your manufacturing process. It plots individual measurements over time and signals when the process goes out of statistical control — *before* products start failing specification.

### 7.2 How Measurements Feed into SPC

When you log an inspection with measured values, those values are automatically stored for SPC analysis. The system:
- Plots each measurement on a control chart
- Compares the value against UCL/LCL set in the Quality Plan parameter
- Flags out-of-control points
- Calculates **Cpk** (Process Capability Index)

### 7.3 Reading Cpk Values

```
Cpk ≥ 1.67  →  Excellent — Six-Sigma capable
Cpk ≥ 1.33  →  Good — meets most quality standards
Cpk ≥ 1.00  →  Marginal — process needs improvement
Cpk < 1.00  →  Poor — significant non-conformances expected
```

### 7.4 Accessing SPC Charts

Go to **Quality → SPC Charts**:
1. Select a parameter from the dropdown
2. The chart shows: individual measurements, UCL/LCL control lines, center line (mean), and out-of-control flags (highlighted red)
3. Cpk is displayed alongside the chart

---

## 8. ISA-95 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENTERPRISE LEVEL                            │
│  Product Spec ──────────────────────────────► Quality Plan          │
│  (USL/LSL from R&D)                           (QualityTestSpec)     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │        MES LEVEL (MES360°)       │
                    │                                   │
                    │   Work Order ──────────────────►  │
                    │       │         Inspection        │
                    │       │         (QualityTest       │
                    │       │          Result)           │
                    │       │              │             │
                    │       ▼              ▼             │
                    │  Batch Record   PASS / FAIL        │
                    │       │              │             │
                    │       │         FAIL ▼             │
                    │       │         NCR raised         │
                    │       │              │             │
                    │       │              ▼             │
                    │       │         CAPA created       │
                    │       │              │             │
                    │       └──────────────┘             │
                    │              │                     │
                    │              ▼                     │
                    │    Traceability Record             │
                    │  (RM Lot → WO → Batch → NCR)      │
                    │                                   │
                    └───────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │      CONTROL LEVEL (SPC)          │
                    │  Measurements → UCL/LCL check     │
                    │  Cpk calculation                  │
                    │  Out-of-control alerts            │
                    └───────────────────────────────────┘
```

### Data Flow Summary

| Step | Action | ISA-95 Object | MES360° Page |
|---|---|---|---|
| 1 | Define what to inspect | QualityTestSpecification | Quality Plans |
| 2 | Define each measurement | QualityTestSpecificationProperty | Check Points |
| 3 | Approve the plan | — | Quality Plans → Approve |
| 4 | Create Work Order | ProductionRequest | Production → Work Orders |
| 5 | Start production | ProductionResponse | Production → Work Orders |
| 6 | Log inspection | QualityTestResult | Quality → Inspections |
| 7 | Select plan & enter measurements | QualityTestResult properties | Inspections form |
| 8 | System calculates result | — | Auto: PASS/FAIL/CONDITIONAL |
| 9 | On FAIL: raise NCR | NonConformanceReport | Quality → NCR |
| 10 | Raise CAPA | CorrectiveAction | Quality → CAPA |
| 11 | Complete CAPA → verify effectiveness | — | CAPA workflow |
| 12 | View on SPC chart | SPCMeasurement | Quality → SPC Charts |

---

## 9. Quick Reference — Field Definitions

### Inspection Result Calculation

The system auto-calculates the overall inspection result:

```
Pass Rate = passQty / totalQty × 100

PASS        → Pass Rate ≥ 95%
CONDITIONAL → Pass Rate 80%–94%
FAIL        → Pass Rate < 80%
```

### Inspection Types

| Type | When Used | Typical Trigger |
|---|---|---|
| `INCOMING` | When materials arrive | Goods receipt / PO delivery |
| `IN_PROCESS` | During production | Scheduled by operator / quality engineer |
| `FINAL` | Before dispatch | Work Order completion gate |
| `PATROL` | Random floor audit | Quality patrol schedule |
| `AUDIT` | Process / system audit | Internal or external audit |

### NCR Severity Levels

| Severity | Definition | Response Time |
|---|---|---|
| `MINOR` | Cosmetic or minor deviation, product still usable | 7 days |
| `MAJOR` | Functional deviation, product may not meet requirements | 3 days |
| `CRITICAL` | Safety or critical quality failure, stop production | Immediate |

### CAPA Priority Levels

| Priority | When to Use |
|---|---|
| `LOW` | Minor process improvement, no immediate risk |
| `MEDIUM` | Quality risk but production continues |
| `HIGH` | Recurring defect or customer-facing issue |
| `CRITICAL` | Safety / regulatory issue, production stopped |

---

## 10. Common Scenarios & Examples

### Scenario A: New Product Launch — Setting Up Quality Plans

**Situation:** A new product, Betti 500ml, is being introduced. Quality plans must be defined before production starts.

1. **Create Incoming RM Plan:**
   - Code: `QP-RM-BETTI500-001`
   - Type: `INCOMING`
   - Parameters: Sugar purity (%), Water activity (Aw), Packaging weight (g)
   - Set USL/LSL from product specification
   - Approve the plan

2. **Create In-Process Plan:**
   - Code: `QP-IP-BETTI500-001`
   - Type: `IN_PROCESS`
   - Sampling: `HOURLY`, qty `5`
   - Parameters: Fill weight (g), Seal strength (N), Cap torque (N·cm), Label placement (mm)
   - Set UCL/LCL from historical SPC data for similar products
   - Approve the plan

3. **Create Final Inspection Plan:**
   - Code: `QP-FN-BETTI500-001`
   - Type: `FINAL`
   - Parameters: Net weight, Appearance score (1–5), Barcode scan, Carton integrity
   - Approve the plan

---

### Scenario B: Recurring Fill Weight Defect

**Situation:** The quality engineer notices fill weight measurements drifting low over two shifts.

1. Go to **Quality → SPC Charts**, select "Fill Weight" parameter
2. See that the last 6 measurements are trending below the LCL
3. Log an **IN_PROCESS** inspection, result = `CONDITIONAL`
4. Raise an **NCR**: Severity `MAJOR`, Category `FILL_WEIGHT`, Qty `120 units`
5. Transition NCR to `IN_REVIEW` — investigate the filling machine calibration
6. Root cause found: filling nozzle partially blocked
7. Transition to `CAPA_PENDING`, create a `CORRECTIVE` CAPA:
   - Action 1: Clean and recalibrate nozzle #3 (Maintenance → today)
   - Action 2: Add nozzle inspection to weekly PM checklist (QA Manager → this week)
8. Both actions completed → submit for verification
9. Monitor SPC chart for next 24 hours → no recurrence → close CAPA
10. Transition NCR to `RESOLVED` → `CLOSED`

---

### Scenario C: Incoming Material Rejection

**Situation:** A batch of packaging film arrives but the thickness is out of specification.

1. Goods received → log **INCOMING** inspection using plan `QP-RM-FILM-001`
2. Measure thickness: 3 samples read 0.08mm, 0.07mm, 0.07mm (LSL = 0.09mm)
3. Result = `FAIL`
4. Raise NCR: Severity `MAJOR`, Category `RAW_MATERIAL`, Disposition = `RETURN_TO_SUPPLIER`
5. Material Lot is placed in the **Quarantine** storage zone
6. Notify procurement to contact supplier
7. NCR progresses through workflow → CLOSED when replacement materials are accepted

---

## API Reference (for System Integration)

For integrating external systems or custom automation:

```
Quality Plans:
  GET    /api/v1/quality/plans              List all plans with parameters
  GET    /api/v1/quality/plans/:id          Get plan with all check points
  POST   /api/v1/quality/plans              Create a new plan
  PATCH  /api/v1/quality/plans/:id          Update plan settings
  DELETE /api/v1/quality/plans/:id          Delete plan (no inspections)
  PATCH  /api/v1/quality/plans/:id/approve  Approve plan

Check Points:
  POST   /api/v1/quality/plans/:id/parameters              Add parameter
  PATCH  /api/v1/quality/plans/:id/parameters/:paramId     Update parameter
  DELETE /api/v1/quality/plans/:id/parameters/:paramId     Delete parameter

Inspections:
  GET    /api/v1/quality/inspections          List with filters
  POST   /api/v1/quality/inspections          Log new inspection
  PATCH  /api/v1/quality/inspections/:id      Update inspection
  DELETE /api/v1/quality/inspections/:id      Delete inspection
  GET    /api/v1/quality/work-orders/:id/inspections   All inspections for a WO

NCR:
  GET    /api/v1/quality/ncr                 List with filters
  POST   /api/v1/quality/ncr                 Raise new NCR
  PATCH  /api/v1/quality/ncr/:id             Update NCR
  PATCH  /api/v1/quality/ncr/:id/status      Transition status
  DELETE /api/v1/quality/ncr/:id             Delete open NCR

CAPA:
  GET    /api/v1/quality/capa                List with filters
  POST   /api/v1/quality/capa                Create CAPA
  PATCH  /api/v1/quality/capa/:id            Update CAPA
  POST   /api/v1/quality/capa/:id/actions    Add action item
  PATCH  /api/v1/quality/capa/:id/verify     Verify effectiveness
  PATCH  /api/v1/quality/capa/:id/close      Close CAPA

SPC:
  GET    /api/v1/quality/spc                 SPC parameters with Cpk
  GET    /api/v1/quality/spc/measurements    Measurement history
```

---

*This document covers the MES360° Quality Module as implemented per ISA-95 Part 3 Manufacturing Operations Management standard. For deployment and infrastructure details, see [DEPLOYMENT.md](./DEPLOYMENT.md). For full system architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).*
