# MES360° — Seed Users Reference / مرجع مستخدمي الـ Seed

> Source of truth: [`apps/api/prisma/seed-ncc-master.ts`](../apps/api/prisma/seed-ncc-master.ts)
> هذا الملف وصفي فقط — الكود في الـ seed هو المرجع الفعلي. أي تعديل على المستخدمين يجب أن يبدأ من هناك.

**Enterprise:** `NCC` — National Care Company
**PoC factory (carries all master data):** `SDPF` — Saudi Detergent Powder Factory
**Total seeded users:** 3 super-admins + 110 per-role users = **113**

---

## 1. Super-Admins (الإدارة العليا — دخول لكل المصانع)

`factoryId = null` ⇒ لا يحتاجون اختيار مصنع عند الدخول. الصلاحية: `SUPER_ADMIN`.
كلمة المرور = الإيميل متبوعًا بـ `@` ثم الإيميل مرة أخرى.

| # | Email (Username) | Password | Role | Name |
|---|------------------|----------|------|------|
| 1 | `admin@mes360.sa` | `admin@mes360.sa@admin@mes360.sa` | SUPER_ADMIN | System Administrator |
| 2 | `developer@mes360.sa` | `developer@mes360.sa@developer@mes360.sa` | SUPER_ADMIN | Platform Developer |
| 3 | `vendor@mes360.sa` | `vendor@mes360.sa@vendor@mes360.sa` | SUPER_ADMIN | Vendor / Integrator |

---

## 2. Per-Role Users (مستخدم لكل صلاحية لكل مصنع)

- **عدد المستخدمين لكل صلاحية لكل مصنع:** 2 (مثال: `operator1_sdpf`, `operator2_sdpf`).
- **نمط الإيميل:** `<roleKey><N>_<factory>@mes360.sa`
- **كلمة المرور:** اسم الصلاحية نفسه بحروف صغيرة (نفس الباسورد لكل مستخدمي نفس الصلاحية في كل المصانع).
- **الدخول:** هؤلاء ليسوا SUPER_ADMIN، لذا يجب اختيار **كود المصنع** (`factoryCode`) عند تسجيل الدخول — مثال: `SDPF`, `SIDCO`, `SAF`, `NDPF`, `RNTIC`.

### المصانع الخمسة

| Code | Factory | City |
|------|---------|------|
| `SDPF` | Saudi Detergent Powder Factory (PoC) | Dammam |
| `SIDCO` | Saudi Industrial Detergent Company | Dammam |
| `SAF` | Saudi Aerosol Factory | Dammam |
| `NDPF` | National Detergent Powder Factory | Dammam |
| `RNTIC` | Plastic Blow Molding Manufacturing | Jeddah |

### الصلاحيات الـ11 (مفتاح الإيميل + كلمة المرور)

| Role (enum) | Email key | Password | Department |
|-------------|-----------|----------|------------|
| `FACTORY_ADMIN` | `factoryadmin` | `factory_admin` | Operations |
| `PLANT_MANAGER` | `plantmanager` | `plant_manager` | Operations |
| `PRODUCTION_MANAGER` | `prodmanager` | `production_manager` | Production |
| `PRODUCTION_SUPERVISOR` | `prodsupervisor` | `production_supervisor` | Production |
| `QUALITY_MANAGER` | `qualitymanager` | `quality_manager` | Quality |
| `QUALITY_ENGINEER` | `qualityengineer` | `quality_engineer` | Quality |
| `MAINTENANCE_MANAGER` | `maintmanager` | `maintenance_manager` | Maintenance |
| `MAINTENANCE_TECHNICIAN` | `mainttech` | `maintenance_technician` | Maintenance |
| `ENERGY_MANAGER` | `energymanager` | `energy_manager` | Energy |
| `OPERATOR` | `operator` | `operator` | Production |
| `VIEWER` | `viewer` | `viewer` | General |

### مثال كامل لمصنع واحد (SDPF)

نفس النمط يتكرر حرفيًا لكل مصنع — فقط استبدل `sdpf` بكود المصنع بحروف صغيرة (`sidco`, `saf`, `ndpf`, `rntic`).

| Email | Password | Factory code @ login |
|-------|----------|----------------------|
| `factoryadmin1_sdpf@mes360.sa` / `factoryadmin2_sdpf@mes360.sa` | `factory_admin` | `SDPF` |
| `plantmanager1_sdpf@mes360.sa` / `plantmanager2_sdpf@mes360.sa` | `plant_manager` | `SDPF` |
| `prodmanager1_sdpf@mes360.sa` / `prodmanager2_sdpf@mes360.sa` | `production_manager` | `SDPF` |
| `prodsupervisor1_sdpf@mes360.sa` / `prodsupervisor2_sdpf@mes360.sa` | `production_supervisor` | `SDPF` |
| `qualitymanager1_sdpf@mes360.sa` / `qualitymanager2_sdpf@mes360.sa` | `quality_manager` | `SDPF` |
| `qualityengineer1_sdpf@mes360.sa` / `qualityengineer2_sdpf@mes360.sa` | `quality_engineer` | `SDPF` |
| `maintmanager1_sdpf@mes360.sa` / `maintmanager2_sdpf@mes360.sa` | `maintenance_manager` | `SDPF` |
| `mainttech1_sdpf@mes360.sa` / `mainttech2_sdpf@mes360.sa` | `maintenance_technician` | `SDPF` |
| `energymanager1_sdpf@mes360.sa` / `energymanager2_sdpf@mes360.sa` | `energy_manager` | `SDPF` |
| `operator1_sdpf@mes360.sa` / `operator2_sdpf@mes360.sa` | `operator` | `SDPF` |
| `viewer1_sdpf@mes360.sa` / `viewer2_sdpf@mes360.sa` | `viewer` | `SDPF` |

> للمصانع الأخرى: استبدل `_sdpf` بـ `_sidco` / `_saf` / `_ndpf` / `_rntic` وكلمة المرور تبقى نفسها (اسم الصلاحية).
> مثال: `operator1_sidco@mes360.sa` كلمة مروره `operator` ويدخل باختيار المصنع `SIDCO`.

---

## 3. ملاحظات تشغيلية

- **البيانات الرئيسية** (ماكينات M1–M5، 31 SKU، الورديات S1/S2، المواد الخام، قطع الغيار، أسباب التوقف) كلها مربوطة بمصنع **SDPF** الآن (كانت SIDCO سابقًا).
- المصانع الأربعة الأخرى (SIDCO, SAF, NDPF, RNTIC) دبابيس على الخريطة بدون بيانات رئيسية، لكن لها مستخدمون لكل صلاحية.
- المستخدمون الحقيقيون الثلاثة القدامى (`issa.masadeh`, `mohammed.brakat`, `mohammed.yousef @sidco.com.sa`) **تم حذفهم** واستُبدلوا بمستخدمي الجدول أعلاه.
- الـ seed **يُعيد ضبط قاعدة البيانات بالكامل** (TRUNCATE) ولا يعمل إلا على قاعدة فارغة (يحرسه `prod-init.js`). إعادة تشغيل الستاك لا تمسح البيانات المُدخلة.
- إعادة التوليد: `docker exec mes-api npx ts-node prisma/seed-ncc-master.ts` (على قاعدة فارغة) — راجع ذاكرة النشر (rebuild image + recreate) قبل التطبيق على بيئة حية.
