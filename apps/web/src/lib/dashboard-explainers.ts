// ============================================================
// DASHBOARD EXPLAINERS — bilingual (EN/AR) help content shown by the
// <DashboardInfo id="…" /> info icon on each dashboard/analytics page.
//
// Each entry documents: what the page shows, how every metric is calculated,
// where the data comes from (API + source of truth), the world-class benchmark
// for each metric, and how to act on it. Keep formulas consistent with the
// backend engines (see docs/DASHBOARD-AUDIT.md and docs/DESIGN-oee-kpi-engine.md).
// ============================================================

export type Bi = { en: string; ar: string };

export interface ExplainerMetric {
  name: Bi;
  formula?: string;      // shown verbatim (language-neutral)
  desc: Bi;
  benchmark?: Bi;        // world-class target / how to read it
}

export interface Explainer {
  title: Bi;
  summary: Bi;
  metrics?: ExplainerMetric[];
  dataSources?: Bi[];
  howToUse?: Bi[];
  notes?: Bi[];
}

const OEE_METRICS: ExplainerMetric[] = [
  {
    name: { en: 'OEE — Overall Equipment Effectiveness', ar: 'OEE — الفعالية الكلية للمعدّات' },
    formula: 'OEE = Availability × Performance × Quality',
    desc: {
      en: 'The single headline number for how effectively equipment runs. It multiplies the three loss buckets so a weakness in any one pulls OEE down.',
      ar: 'الرقم الرئيسي الذي يعبّر عن كفاءة تشغيل المعدّة. يضرب العوامل الثلاثة معًا، فأي ضعف في أحدها يخفض OEE.',
    },
    benchmark: { en: 'World-class ≥ 85%. 60% is typical, < 40% needs urgent action.', ar: 'عالمي ≥ 85%. المعتاد 60%، وأقل من 40% يستدعي تدخلاً عاجلاً.' },
  },
  {
    name: { en: 'Availability', ar: 'الجاهزية' },
    formula: 'Availability = Run Time ÷ Planned Production Time',
    desc: {
      en: 'Share of planned time the equipment was actually running. Lost to breakdowns, setups and unplanned stops.',
      ar: 'نسبة الوقت المخطط الذي كانت فيه المعدّة تعمل فعليًا. تُفقد بسبب الأعطال والتجهيز والتوقفات غير المخططة.',
    },
    benchmark: { en: 'World-class ≥ 90%.', ar: 'عالمي ≥ 90%.' },
  },
  {
    name: { en: 'Performance', ar: 'الأداء' },
    formula: 'Performance = (Ideal Cycle Time × Total Count) ÷ Run Time',
    desc: {
      en: 'How close the line ran to its ideal speed while running. Lost to minor stops and reduced speed.',
      ar: 'مدى اقتراب الخط من سرعته المثالية أثناء التشغيل. يُفقد بسبب التوقفات الصغيرة وانخفاض السرعة.',
    },
    benchmark: { en: 'World-class ≥ 95%.', ar: 'عالمي ≥ 95%.' },
  },
  {
    name: { en: 'Quality', ar: 'الجودة' },
    formula: 'Quality = Good Count ÷ Total Count',
    desc: {
      en: 'Share of produced units that met spec the first time. Lost to scrap and rework.',
      ar: 'نسبة الوحدات المنتجة التي طابقت المواصفات من المرة الأولى. تُفقد بسبب الهدر وإعادة العمل.',
    },
    benchmark: { en: 'World-class ≥ 99%.', ar: 'عالمي ≥ 99%.' },
  },
];

export const EXPLAINERS: Record<string, Explainer> = {
  // ── Insights Studio (grouped analytics) ──────────────────────
  'insights-studio': {
    title: { en: 'Insights Studio', ar: 'استوديو التحليلات' },
    summary: {
      en: 'A single analytical canvas: pick a grouping dimension (Shift / Production Order / Work Order / Machine / Time) and every chart re-aggregates OEE, output, scrap and the A·P·Q breakdown for the selected period and scope.',
      ar: 'لوحة تحليلية موحّدة: اختر بُعد التجميع (وردية/أمر إنتاج/أمر عمل/آلة/زمن) فتُعيد كل الرسوم تجميع OEE والإنتاج والهدر وتفصيل A·P·Q للفترة والنطاق المختارين.',
    },
    metrics: [
      { name: { en: 'OEE by group', ar: 'OEE حسب المجموعة' }, formula: 'time-weighted rollup per group', desc: { en: 'Compare effectiveness across shifts/orders/machines to find the best and worst performers.', ar: 'قارن الفعالية بين الورديات/الأوامر/الآلات لإيجاد الأفضل والأسوأ.' }, benchmark: { en: 'World-class ≥ 85%.', ar: 'عالمي ≥ 85%.' } },
      { name: { en: 'Output (good vs scrap)', ar: 'الإنتاج (سليم مقابل هدر)' }, desc: { en: 'Produced quantity split into good and scrap per group — shows where quality losses concentrate.', ar: 'الكمية المنتَجة مقسّمة سليم/هدر لكل مجموعة — تُظهر أين تتركّز خسائر الجودة.' } },
      { name: { en: 'A·P·Q by group', ar: 'A·P·Q حسب المجموعة' }, desc: { en: 'The three OEE factors side by side per group — pinpoints whether availability, speed or quality is the constraint.', ar: 'عوامل OEE الثلاثة جنبًا إلى جنب لكل مجموعة — تحدّد ما إذا كان القيد في الجاهزية أو السرعة أو الجودة.' } },
    ],
    dataSources: [
      { en: 'GET /production/oee/calculate (period KPIs) + GET /production/oee/trend?groupBy=… (grouped rollups) — same time-weighted engine as every OEE page.', ar: 'GET /production/oee/calculate (مؤشرات الفترة) + GET /production/oee/trend?groupBy=… (تجميعات) — نفس المحرك المرجّح بالزمن لكل صفحات OEE.' },
    ],
    howToUse: [
      { en: 'Group by Shift to compare crews; by Work Order to audit a run; by Machine to rank equipment; by Time to see the trend.', ar: 'جمّع حسب الوردية لمقارنة الفرق؛ حسب أمر العمل لتدقيق تشغيلة؛ حسب الآلة لترتيب المعدّات؛ حسب الزمن لرؤية الاتجاه.' },
    ],
    notes: [
      { en: 'Everything here is PERIOD data (the badge marks it) — it responds to the time range and scope, unlike live machine-state cards elsewhere.', ar: 'كل ما هنا بيانات فترة (تُعلّمها الشارة) — تستجيب للفترة والنطاق، بخلاف بطاقات حالة الآلة اللحظية في صفحات أخرى.' },
    ],
  },
  // ── Production ───────────────────────────────────────────────
  'production-overview': {
    title: { en: 'Production Overview', ar: 'نظرة عامة على الإنتاج' },
    summary: {
      en: 'Live operational picture of the factory: real-time OEE and its three factors, plus the active work-order list with progress and status.',
      ar: 'صورة تشغيلية حيّة للمصنع: OEE اللحظي وعوامله الثلاثة، مع قائمة أوامر العمل النشطة وتقدّمها وحالتها.',
    },
    metrics: [
      ...OEE_METRICS,
      {
        name: { en: 'Work-order counts (Total / Completed / In Progress)', ar: 'أعداد أوامر العمل (الكل / المكتمل / الجاري)' },
        desc: { en: 'Status tally of work orders in the current scope. Drives the completion ratio.', ar: 'حصر حالات أوامر العمل ضمن النطاق الحالي. يحدد نسبة الإنجاز.' },
        benchmark: { en: 'Watch In-Progress vs capacity — a large backlog signals a bottleneck.', ar: 'راقب الجاري مقابل الطاقة — تراكم كبير يعني وجود اختناق.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/kpis — OEE + order counts (engine rolls Job Order → Work Order → Production Order).', ar: 'GET /production/kpis — OEE وأعداد الأوامر (المحرك يجمّع من أمر التشغيل ← أمر العمل ← أمر الإنتاج).' },
      { en: 'GET /production/work-orders — the active work-order list (scoped, not date-windowed).', ar: 'GET /production/work-orders — قائمة أوامر العمل النشطة (حسب النطاق، دون نافذة زمنية).' },
    ],
    howToUse: [
      { en: 'If OEE is low, read which factor (A/P/Q) is lowest and act there first.', ar: 'إذا كان OEE منخفضًا، حدّد أي عامل (A/P/Q) هو الأدنى وعالجه أولاً.' },
      { en: 'Use the area/line/machine scope to localise a problem to one resource.', ar: 'استخدم نطاق المنطقة/الخط/الآلة لعزل المشكلة في مورد واحد.' },
    ],
    notes: [
      { en: 'OEE here matches the OEE page and the home dashboard — all read the same engine, so numbers are consistent across screens.', ar: 'قيمة OEE هنا تطابق صفحة OEE ولوحة البداية — جميعها تقرأ من نفس المحرك، فالأرقام متسقة عبر الشاشات.' },
    ],
  },

  'production-oee': {
    title: { en: 'OEE Analysis', ar: 'تحليل OEE' },
    summary: {
      en: 'Deep-dive into Overall Equipment Effectiveness: the A×P×Q breakdown, trend over time, and per-equipment ranking to find the biggest loss.',
      ar: 'تحليل معمّق للفعالية الكلية للمعدّات: تفصيل A×P×Q، والاتجاه عبر الزمن، وترتيب المعدّات لاكتشاف أكبر مصدر فقد.',
    },
    metrics: OEE_METRICS,
    dataSources: [
      { en: 'GET /production/oee/calculate — current OEE, trend, and per-equipment breakdown for the selected timeframe.', ar: 'GET /production/oee/calculate — OEE الحالي والاتجاه وتفصيل كل معدّة للفترة المختارة.' },
      { en: 'Source of truth: OEERecord rows persisted at each job-order completion; the engine rolls them up the ISA-95 hierarchy.', ar: 'مصدر الحقيقة: سجلات OEERecord المحفوظة عند اكتمال كل أمر تشغيل؛ والمحرك يجمّعها عبر هرم ISA-95.' },
    ],
    howToUse: [
      { en: 'Rank equipment by OEE and attack the bottom of the list — that is where the gain is largest.', ar: 'رتّب المعدّات حسب OEE وعالج أسفل القائمة — هناك أكبر مكسب ممكن.' },
      { en: 'Compare the trend to a shift/process change to confirm whether an action worked.', ar: 'قارن الاتجاه بتغيير ورديّة/عملية للتأكد من نجاح أي إجراء.' },
    ],
  },

  'production-kpi': {
    title: { en: 'Production KPIs', ar: 'مؤشرات الإنتاج' },
    summary: {
      en: 'Key production indicators: OEE factors, throughput, schedule adherence and scrap — to judge plan vs actual at a glance.',
      ar: 'المؤشرات الرئيسية للإنتاج: عوامل OEE، الإنتاجية، الالتزام بالجدول، والهدر — لتقييم المخطط مقابل الفعلي بنظرة واحدة.',
    },
    metrics: [
      ...OEE_METRICS,
      {
        name: { en: 'Schedule adherence', ar: 'الالتزام بالجدول' },
        formula: 'Adherence = On-time Work Orders ÷ Total Due Work Orders',
        desc: { en: 'Share of work orders finished within their planned window.', ar: 'نسبة أوامر العمل المنجزة ضمن نافذتها المخططة.' },
        benchmark: { en: 'Target ≥ 95%.', ar: 'الهدف ≥ 95%.' },
      },
      {
        name: { en: 'Scrap rate', ar: 'نسبة الهدر' },
        formula: 'Scrap Rate = Scrap Qty ÷ Total Produced',
        desc: { en: 'Material lost to rejects across the run.', ar: 'المواد المفقودة كرفض خلال التشغيل.' },
        benchmark: { en: 'Lower is better; track against a per-product target.', ar: 'الأقل أفضل؛ قِسها مقابل هدف لكل منتج.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/kpis and /production/oee/calculate — same engine as the overview, so values reconcile.', ar: 'GET /production/kpis و /production/oee/calculate — نفس محرك النظرة العامة، فالقيم متطابقة.' },
    ],
  },

  'production-downtime': {
    title: { en: 'Downtime Analysis', ar: 'تحليل التوقفات' },
    summary: {
      en: 'Where production time is lost. A Pareto of downtime by cause shows the vital few causes that drive most lost minutes.',
      ar: 'أين يُفقد وقت الإنتاج. مخطط باريتو للتوقفات حسب السبب يُظهر الأسباب القليلة الحيوية التي تسبب معظم الدقائق المفقودة.',
    },
    metrics: [
      {
        name: { en: 'Downtime by cause (Pareto)', ar: 'التوقف حسب السبب (باريتو)' },
        formula: 'Σ downtime minutes per cause, ranked desc + cumulative %',
        desc: { en: 'Total stopped minutes grouped by reason, ranked so the top bars are the priority.', ar: 'إجمالي دقائق التوقف مجمّعة حسب السبب ومرتّبة، فالأعمدة الأولى هي الأولوية.' },
        benchmark: { en: 'The top 20% of causes usually drive ~80% of downtime — fix those first.', ar: 'عادةً 20% من الأسباب تسبب ~80% من التوقف — عالجها أولاً.' },
      },
      {
        name: { en: 'MTTR (Mean Time To Repair)', ar: 'متوسط زمن الإصلاح' },
        formula: 'MTTR = Total Repair Time ÷ Number of Repairs',
        desc: { en: 'How long, on average, a stop lasts. Reflects response + repair speed.', ar: 'متوسط مدة التوقف الواحد. يعكس سرعة الاستجابة والإصلاح.' },
        benchmark: { en: 'Lower is better; trend it downward over time.', ar: 'الأقل أفضل؛ اجعل اتجاهه نحو الانخفاض.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/downtime — downtime events (cause, duration, machine) within the scope + time range.', ar: 'GET /production/downtime — أحداث التوقف (السبب، المدة، الآلة) ضمن النطاق والفترة.' },
    ],
    howToUse: [
      { en: 'Start a Kaizen on the #1 Pareto cause; re-check the chart after the fix to confirm it dropped.', ar: 'ابدأ تحسينًا (كايزن) على السبب الأول في باريتو؛ وأعد فحص المخطط بعد المعالجة للتأكد من انخفاضه.' },
    ],
  },

  // ── Maintenance ──────────────────────────────────────────────
  'maintenance-overview': {
    title: { en: 'Maintenance Overview', ar: 'نظرة عامة على الصيانة' },
    summary: {
      en: 'Reliability and workload health: open/overdue work orders, reliability (MTTR/MTBF), asset availability and PM compliance.',
      ar: 'صحة الموثوقية وحمل العمل: الأوامر المفتوحة/المتأخرة، الموثوقية (MTTR/MTBF)، جاهزية الأصول، والالتزام بالصيانة الوقائية.',
    },
    metrics: [
      {
        name: { en: 'MTBF (Mean Time Between Failures)', ar: 'متوسط الزمن بين الأعطال' },
        formula: 'MTBF = Operating Time ÷ Number of Failures',
        desc: { en: 'Average uptime between breakdowns — the core reliability measure. Higher = more reliable.', ar: 'متوسط زمن التشغيل بين الأعطال — مقياس الموثوقية الأساسي. الأعلى = أكثر موثوقية.' },
        benchmark: { en: 'Higher is better; trend upward.', ar: 'الأعلى أفضل؛ اجعل اتجاهه صاعدًا.' },
      },
      {
        name: { en: 'MTTR (Mean Time To Repair)', ar: 'متوسط زمن الإصلاح' },
        formula: 'MTTR = Total Repair Time ÷ Number of Repairs',
        desc: { en: 'Average time to restore a failed asset. Lower = faster recovery.', ar: 'متوسط زمن إعادة الأصل للعمل. الأقل = تعافٍ أسرع.' },
        benchmark: { en: 'Lower is better.', ar: 'الأقل أفضل.' },
      },
      {
        name: { en: 'Asset Availability', ar: 'جاهزية الأصل' },
        formula: 'Availability = MTBF ÷ (MTBF + MTTR)',
        desc: { en: 'Share of time an asset is ready to run — combines how often it fails and how fast it is fixed.', ar: 'نسبة جاهزية الأصل للعمل — تجمع تكرار العطل وسرعة الإصلاح.' },
        benchmark: { en: 'World-class ≥ 90%.', ar: 'عالمي ≥ 90%.' },
      },
      {
        name: { en: 'PM Compliance', ar: 'الالتزام بالصيانة الوقائية' },
        formula: 'PM Compliance = PMs Completed On-time ÷ PMs Scheduled',
        desc: { en: 'Discipline of preventive maintenance. Low compliance precedes more breakdowns.', ar: 'انضباط الصيانة الوقائية. الالتزام المنخفض يسبق زيادة الأعطال.' },
        benchmark: { en: 'Target ≥ 90%.', ar: 'الهدف ≥ 90%.' },
      },
      {
        name: { en: 'Open / Overdue Work Orders', ar: 'الأوامر المفتوحة / المتأخرة' },
        desc: { en: 'Current maintenance backlog and how much of it is past its due date.', ar: 'تراكم الصيانة الحالي وكم منه تجاوز تاريخ الاستحقاق.' },
        benchmark: { en: 'Overdue should trend to zero; a rising backlog signals under-capacity.', ar: 'المتأخر يجب أن يتجه للصفر؛ تراكم متزايد يعني نقص طاقة.' },
      },
    ],
    dataSources: [
      { en: 'GET /maintenance/kpis — MTTR, MTBF, availability, PM compliance, open/overdue counts.', ar: 'GET /maintenance/kpis — MTTR وMTBF والجاهزية والالتزام والأعداد المفتوحة/المتأخرة.' },
      { en: 'GET /maintenance/work-orders — the maintenance WO list.', ar: 'GET /maintenance/work-orders — قائمة أوامر الصيانة.' },
      { en: 'Reliability is computed from completed maintenance WOs and downtime events for the scoped assets.', ar: 'تُحسب الموثوقية من أوامر الصيانة المكتملة وأحداث التوقف للأصول ضمن النطاق.' },
    ],
    howToUse: [
      { en: 'Falling MTBF + rising MTTR = a deteriorating asset; schedule a deeper PM or overhaul.', ar: 'انخفاض MTBF مع ارتفاع MTTR = أصل يتدهور؛ جدوِل صيانة وقائية أعمق أو عُمرة.' },
    ],
    notes: [
      { en: 'MTTR/MTBF here use the same definitions as the reliability trend chart, so the two are reconcilable.', ar: 'تستخدم MTTR/MTBF هنا نفس تعريفات مخطط اتجاه الموثوقية، فهما متطابقان.' },
    ],
  },

  // ── Quality ──────────────────────────────────────────────────
  'quality-overview': {
    title: { en: 'Quality Overview', ar: 'نظرة عامة على الجودة' },
    summary: {
      en: 'Conformance health: First Pass Yield, defect/scrap rate, open NCRs and CAPA progress — the voice of quality on the floor.',
      ar: 'صحة المطابقة: نسبة النجاح من المرة الأولى، معدل العيوب/الهدر، حالات عدم المطابقة المفتوحة، وتقدّم الإجراءات التصحيحية.',
    },
    metrics: [
      {
        name: { en: 'First Pass Yield (FPY)', ar: 'نسبة النجاح من المرة الأولى' },
        formula: 'FPY = Units Passing First Time ÷ Total Units Inspected',
        desc: { en: 'Share of output that passed inspection without rework — the cleanest quality signal.', ar: 'نسبة الإنتاج الذي اجتاز الفحص دون إعادة عمل — أنقى إشارة جودة.' },
        benchmark: { en: 'World-class ≥ 99%; below 95% means significant rework cost.', ar: 'عالمي ≥ 99%؛ أقل من 95% يعني تكلفة إعادة عمل كبيرة.' },
      },
      {
        name: { en: 'Defect / Scrap Rate', ar: 'معدل العيوب / الهدر' },
        formula: 'Defect Rate = Failed Qty ÷ Total Inspected',
        desc: { en: 'Proportion of inspected units rejected. The inverse pressure on FPY.', ar: 'نسبة الوحدات المرفوضة من المفحوصة. الضغط العكسي على FPY.' },
        benchmark: { en: 'Lower is better; track in PPM for mature lines.', ar: 'الأقل أفضل؛ تُقاس بالـ PPM للخطوط الناضجة.' },
      },
      {
        name: { en: 'Open NCRs', ar: 'حالات عدم المطابقة المفتوحة' },
        desc: { en: 'Non-conformance reports not yet resolved — unresolved quality risk.', ar: 'تقارير عدم المطابقة غير المغلقة — مخاطر جودة غير محلولة.' },
        benchmark: { en: 'Drive to closure; ageing NCRs are the risk, not the count alone.', ar: 'ادفعها للإغلاق؛ الخطر في تقادمها لا في عددها وحده.' },
      },
      {
        name: { en: 'CAPA Progress', ar: 'تقدّم الإجراءات التصحيحية' },
        desc: { en: 'Corrective/Preventive actions and their completion — closes the loop on root causes.', ar: 'الإجراءات التصحيحية/الوقائية ونسبة إنجازها — تغلق الحلقة على الأسباب الجذرية.' },
        benchmark: { en: 'On-time CAPA closure ≥ 90%.', ar: 'إغلاق الإجراءات في موعدها ≥ 90%.' },
      },
    ],
    dataSources: [
      { en: 'GET /quality/kpis — FPY, defect rate, NCR/CAPA counts.', ar: 'GET /quality/kpis — FPY ومعدل العيوب وأعداد NCR/CAPA.' },
      { en: 'Computed from InspectionResult (pass/fail), NCR and CAPA records for the scope.', ar: 'تُحسب من نتائج الفحص (نجاح/فشل) وسجلات NCR وCAPA ضمن النطاق.' },
    ],
    howToUse: [
      { en: 'A drop in FPY plus a spike on one defect type points to a specific process/parameter to correct.', ar: 'انخفاض FPY مع ارتفاع نوع عيب واحد يشير إلى عملية/معيار محدد لتصحيحه.' },
    ],
    notes: [
      { en: 'Quality% in OEE and FPY measure related but different things: OEE-Quality counts good vs total produced; FPY counts first-time-pass at inspection.', ar: 'الجودة في OEE وFPY يقيسان أمرين مترابطين لكن مختلفين: جودة OEE تحسب السليم مقابل المنتَج؛ وFPY يحسب النجاح من أول فحص.' },
    ],
  },

  // ── Inventory ────────────────────────────────────────────────
  'inventory-overview': {
    title: { en: 'Inventory Overview', ar: 'نظرة عامة على المخزون' },
    summary: {
      en: 'Stock health across materials, spare parts, products and lots: total value, low-stock exposure and movement at a glance.',
      ar: 'صحة المخزون عبر المواد وقطع الغيار والمنتجات والدفعات: القيمة الإجمالية، تعرّض المخزون المنخفض، والحركة بنظرة واحدة.',
    },
    metrics: [
      {
        name: { en: 'Stock Value', ar: 'قيمة المخزون' },
        formula: 'Σ (on-hand qty × unit cost) across items',
        desc: { en: 'Capital tied up in inventory — the working-capital view.', ar: 'رأس المال المحتجز في المخزون — منظور رأس المال العامل.' },
        benchmark: { en: 'Balance service level vs carrying cost; avoid both stock-outs and overstock.', ar: 'وازن مستوى الخدمة مقابل تكلفة الاحتفاظ؛ تجنّب النفاد والتكدّس معًا.' },
      },
      {
        name: { en: 'Low-stock items', ar: 'أصناف منخفضة المخزون' },
        formula: 'count where on-hand ≤ reorder point (or min stock)',
        desc: { en: 'Items at or below their reorder threshold — replenishment risk.', ar: 'أصناف عند أو تحت حد إعادة الطلب — خطر نفاد.' },
        benchmark: { en: 'Keep critical raw materials out of this list to avoid line stops.', ar: 'أبقِ المواد الخام الحرجة خارج هذه القائمة لتجنّب توقف الخطوط.' },
      },
      {
        name: { en: 'Available stock', ar: 'المخزون المتاح' },
        formula: 'Available = Current Stock − Reserved Stock',
        desc: { en: 'What is truly free to consume after soft-reservations by active work orders.', ar: 'ما هو متاح فعليًا للاستهلاك بعد الحجز المبدئي لأوامر العمل النشطة.' },
        benchmark: { en: 'This — not gross stock — is what the material-shortage gate checks.', ar: 'هذا — لا المخزون الإجمالي — هو ما تتحقق منه بوابة نقص المواد.' },
      },
    ],
    dataSources: [
      { en: 'GET /inventory/overview — value, counts and stock-health rollups.', ar: 'GET /inventory/overview — القيمة والأعداد وملخصات صحة المخزون.' },
      { en: 'Sources of truth: RawMaterial.currentStock/reservedStock, SparePart.stockQty, MaterialLot.remainingQty, SKU.currentStock.', ar: 'مصادر الحقيقة: RawMaterial.currentStock/reservedStock وSparePart.stockQty وMaterialLot.remainingQty وSKU.currentStock.' },
    ],
    howToUse: [
      { en: 'Clear the low-stock list before releasing work orders that consume those materials.', ar: 'عالج قائمة المخزون المنخفض قبل إطلاق أوامر عمل تستهلك تلك المواد.' },
    ],
  },

  // ── Energy ───────────────────────────────────────────────────
  'energy-overview': {
    title: { en: 'Energy Overview', ar: 'نظرة عامة على الطاقة' },
    summary: {
      en: 'Energy consumption and cost: total kWh and cost month-to-date, breakdown by type, and the consumption trend.',
      ar: 'استهلاك الطاقة وتكلفتها: إجمالي الكيلوواط·ساعة والتكلفة حتى تاريخه، التوزيع حسب النوع، واتجاه الاستهلاك.',
    },
    metrics: [
      {
        name: { en: 'Consumption (kWh)', ar: 'الاستهلاك (ك.و.س)' },
        formula: 'Σ meter readings over the period (per type)',
        desc: { en: 'Total energy used, optionally split by source (electricity, gas, water, steam…).', ar: 'إجمالي الطاقة المستهلكة، ويمكن تقسيمها حسب المصدر (كهرباء، غاز، ماء، بخار…).' },
      },
      {
        name: { en: 'Cost', ar: 'التكلفة' },
        formula: 'Cost = Σ (consumption × tariff)',
        desc: { en: 'Monetary cost using the configured tariffs — the financial lens on energy.', ar: 'التكلفة المالية وفق التعرفات المهيّأة — المنظور المالي للطاقة.' },
      },
      {
        name: { en: 'Energy intensity', ar: 'كثافة الطاقة' },
        formula: 'Intensity = Energy ÷ Units Produced',
        desc: { en: 'Energy per produced unit — normalises consumption against output so you compare like-for-like.', ar: 'الطاقة لكل وحدة منتجة — تطبّع الاستهلاك مقابل الإنتاج لمقارنة عادلة.' },
        benchmark: { en: 'Lower is better; rising intensity at flat output flags waste.', ar: 'الأقل أفضل؛ ارتفاع الكثافة مع ثبات الإنتاج يدل على هدر.' },
      },
    ],
    dataSources: [
      { en: 'GET /energy/overview and /energy/consumption — meter rollups + trend from the time-series store (InfluxDB) and EnergySummary.', ar: 'GET /energy/overview و /energy/consumption — ملخصات العدّادات والاتجاه من مخزن السلاسل الزمنية (InfluxDB) وEnergySummary.' },
    ],
    howToUse: [
      { en: 'Compare intensity across shifts/lines to find energy-inefficient operating modes.', ar: 'قارن الكثافة بين الورديات/الخطوط لاكتشاف أنماط تشغيل مُهدِرة للطاقة.' },
    ],
  },

  // ── Home / Factory dashboard ─────────────────────────────────
  'home-dashboard': {
    title: { en: 'Factory Dashboard', ar: 'لوحة المصنع' },
    summary: {
      en: 'The executive single-pane view: factory-wide OEE, production, downtime Pareto, quality and live status — aggregated across all lines.',
      ar: 'العرض التنفيذي الموحّد: OEE على مستوى المصنع، الإنتاج، باريتو التوقفات، الجودة والحالة الحيّة — مجمّعة عبر كل الخطوط.',
    },
    metrics: OEE_METRICS,
    dataSources: [
      { en: 'Aggregates the same production/maintenance/quality/energy KPI endpoints, so the headline numbers equal the per-module pages.', ar: 'تجمع نفس مؤشرات الإنتاج/الصيانة/الجودة/الطاقة، فالأرقام الرئيسية تساوي صفحات كل وحدة.' },
    ],
    howToUse: [
      { en: 'Use it as the morning stand-up screen; drill into any module page for the root cause.', ar: 'استخدمها كشاشة اجتماع الصباح؛ ثم تعمّق في صفحة الوحدة للسبب الجذري.' },
    ],
  },

  // ── Traceability ─────────────────────────────────────────────
  'traceability': {
    title: { en: 'Traceability', ar: 'التتبّع' },
    summary: {
      en: 'Forward/backward genealogy and the platform event log: trace a finished lot back to its raw material lots, or a raw lot forward to every product it became.',
      ar: 'النسب الأمامي/الخلفي وسجل أحداث المنصة: تتبّع دفعة منتج نهائي رجوعًا إلى دفعات المواد الخام، أو دفعة خام أمامًا إلى كل منتج صُنع منها.',
    },
    metrics: [
      {
        name: { en: 'Backward trace', ar: 'التتبّع الخلفي' },
        desc: { en: 'From a finished-goods lot → work order → consumed material lots (recall scope).', ar: 'من دفعة منتج نهائي ← أمر العمل ← دفعات المواد المستهلكة (نطاق الاستدعاء).' },
      },
      {
        name: { en: 'Forward trace', ar: 'التتبّع الأمامي' },
        desc: { en: 'From a material lot → every work order and finished lot it fed (impact scope).', ar: 'من دفعة مادة ← كل أمر عمل ودفعة نهائية غذّتها (نطاق التأثير).' },
      },
    ],
    dataSources: [
      { en: 'GET /production/traceability/backward|forward and /traceability event feed; built from MaterialConsumption (FEFO lot links) + TraceabilityLink + TraceEvent.', ar: 'GET /production/traceability/backward|forward وتغذية أحداث /traceability؛ مبنية من MaterialConsumption (روابط الدفعات FEFO) وTraceabilityLink وTraceEvent.' },
    ],
    howToUse: [
      { en: 'On a recall, backward-trace the suspect finished lot to bound which raw lots/suppliers are implicated.', ar: 'عند الاستدعاء، تتبّع المنتج المشتبه خلفيًا لتحديد دفعات/موردي المواد المعنية.' },
    ],
  },
};

export const EXPLAINER_LABELS = {
  overview: { en: 'What this page shows', ar: 'ماذا تعرض هذه الصفحة' },
  metrics: { en: 'Metrics & how they are calculated', ar: 'المؤشرات وطريقة حسابها' },
  formula: { en: 'Formula', ar: 'المعادلة' },
  benchmark: { en: 'Target / how to read', ar: 'الهدف / كيف تُقرأ' },
  dataSources: { en: 'Data sources', ar: 'مصادر البيانات' },
  howToUse: { en: 'How to use it', ar: 'كيف تستفيد منها' },
  notes: { en: 'Consistency notes', ar: 'ملاحظات الاتساق' },
  open: { en: 'About this page', ar: 'عن هذه الصفحة' },
};
