/**
 * NCC downtime reason tree — applies the curated 3-level hierarchy (the same one
 * defined in seed.ts) to the live factory, combining the STANDARD ISA-95
 * categories with the machine-specific NCC reasons from
 * docs/NCC - Prerequisites File.xlsx:
 *   L1 (6) Top category  →  L2 (13) Sub-category  →  L3 (~50) Specific reason
 *
 * Idempotent: upserts every node by a stable id, then removes any leftover flat /
 * synthetic causes from earlier seeds (nulling their references first so FK stays
 * intact). Machines are resolved by code (M1=Big Betti, M3=Cartomac, M4=Euro-Pack).
 *
 * Run:  docker exec mes-api npx ts-node prisma/seed-ncc-downtime.ts
 */
import { PrismaClient, DowntimeCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Factory carrying the master data = the one with machines M1..M5
  const m1 = await prisma.machine.findFirst({ where: { code: 'M1' }, select: { id: true, factoryId: true } });
  if (!m1) { console.log('No machine M1 found — is the master seed loaded?'); return; }
  const factoryId = m1.factoryId;
  const byCode = async (code: string) =>
    (await prisma.machine.findFirst({ where: { factoryId, code }, select: { id: true } }))?.id ?? null;
  const bigBetti = m1.id;
  const cartomac = await byCode('M3');
  const euroPackRobot = await byCode('M4');

  const keptIds = new Set<string>();
  const dc = async (id: string, data: Record<string, unknown>) => {
    keptIds.add(id);
    await prisma.downtimeCause.upsert({
      where: { id },
      update: {
        code: data.code as string, name: data.name as string, nameAr: (data.nameAr as string) ?? null,
        category: data.category as DowntimeCategory, level: (data.level as number) ?? 3,
        parentId: (data.parentId as string | null) ?? null, machineId: (data.machineId as string | null) ?? null,
        isPlanned: (data.isPlanned as boolean) ?? false, sortOrder: (data.sortOrder as number) ?? 0, isActive: true,
      },
      create: { id, factoryId, ...(data as any) },
    });
  };

  // ── Level 1 ──
  await dc('dt-l1-01', { code: 'L1-EF',  name: 'Equipment Failure & Breakdown',      nameAr: 'أعطال المعدات والانهيار',  category: DowntimeCategory.MECHANICAL,          level: 1, isPlanned: false, sortOrder: 1 });
  await dc('dt-l1-02', { code: 'L1-HE',  name: 'Human Error & Operational Mistakes', nameAr: 'خطأ بشري وأخطاء تشغيلية',  category: DowntimeCategory.OPERATOR,            level: 1, isPlanned: false, sortOrder: 2 });
  await dc('dt-l1-03', { code: 'L1-MP',  name: 'Poor Maintenance Practices',         nameAr: 'ممارسات صيانة غير كافية',  category: DowntimeCategory.PROCESS,             level: 1, isPlanned: false, sortOrder: 3 });
  await dc('dt-l1-04', { code: 'L1-MS',  name: 'Material & Supply Chain Shortages',  nameAr: 'نقص المواد وسلسلة التوريد', category: DowntimeCategory.MATERIAL,            level: 1, isPlanned: false, sortOrder: 4 });
  await dc('dt-l1-05', { code: 'L1-UN',  name: 'Utility & Network Outages',          nameAr: 'انقطاع المرافق والشبكات',  category: DowntimeCategory.UTILITY,             level: 1, isPlanned: false, sortOrder: 5 });
  await dc('dt-l1-06', { code: 'L1-PLN', name: 'Planned Stops',                      nameAr: 'التوقفات المخططة',         category: DowntimeCategory.PLANNED_MAINTENANCE, level: 1, isPlanned: true,  sortOrder: 6 });

  // ── Level 2 ──
  await dc('dt-l2-01', { code: 'L2-MECH',   name: 'Mechanical Faults',           nameAr: 'أعطال ميكانيكية',           category: DowntimeCategory.MECHANICAL,          level: 2, parentId: 'dt-l1-01', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-02', { code: 'L2-ELEC',   name: 'Electrical Faults',           nameAr: 'أعطال كهربائية',            category: DowntimeCategory.ELECTRICAL,          level: 2, parentId: 'dt-l1-01', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-03', { code: 'L2-SETUP',  name: 'Setup & Changeovers',         nameAr: 'الإعداد والتحويل',          category: DowntimeCategory.CHANGEOVER,          level: 2, parentId: 'dt-l1-02', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-04', { code: 'L2-OPS',    name: 'Operator Unavailability',     nameAr: 'غياب المشغل',               category: DowntimeCategory.OPERATOR,            level: 2, parentId: 'dt-l1-02', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-05', { code: 'L2-PREV',   name: 'Lack of Preventive Care',     nameAr: 'غياب الصيانة الوقائية',     category: DowntimeCategory.PROCESS,             level: 2, parentId: 'dt-l1-03', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-06', { code: 'L2-TOOL',   name: 'Tooling Issues',              nameAr: 'مشاكل الأدوات',             category: DowntimeCategory.MECHANICAL,          level: 2, parentId: 'dt-l1-03', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-07', { code: 'L2-LOG',    name: 'Logistics / Warehouse',       nameAr: 'الخدمات اللوجستية والمستودع', category: DowntimeCategory.MATERIAL,         level: 2, parentId: 'dt-l1-04', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-08', { code: 'L2-QA',     name: 'Quality Inspection Hold',     nameAr: 'تعليق فحص الجودة',          category: DowntimeCategory.QUALITY,             level: 2, parentId: 'dt-l1-04', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-09', { code: 'L2-PWR',    name: 'Power & Pneumatics',          nameAr: 'الطاقة والهواء المضغوط',    category: DowntimeCategory.UTILITY,             level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-10', { code: 'L2-IT',     name: 'IT & Connectivity',           nameAr: 'تقنية المعلومات والاتصالات', category: DowntimeCategory.UTILITY,            level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-11', { code: 'L2-HVAC',   name: 'Environmental & HVAC',        nameAr: 'البيئة وتكييف الهواء',      category: DowntimeCategory.UTILITY,             level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 3 });
  await dc('dt-l2-12', { code: 'L2-BRK',    name: 'Scheduled Breaks & Cleaning', nameAr: 'فترات الراحة والتنظيف',     category: DowntimeCategory.PLANNED_BREAK,       level: 2, parentId: 'dt-l1-06', isPlanned: true,  sortOrder: 1 });
  await dc('dt-l2-13', { code: 'L2-PMAINT', name: 'Planned Maintenance & Changeover', nameAr: 'الصيانة والتحويل المخطط', category: DowntimeCategory.PLANNED_MAINTENANCE, level: 2, parentId: 'dt-l1-06', isPlanned: true, sortOrder: 2 });

  // ── Level 3: Mechanical Faults (L2-01) — generic + NCC ──
  await dc('dt-l3-mech-001', { code: 'MECH-GEN-01', name: 'Jammed Conveyor',  nameAr: 'ناقل محشور',          category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-mech-002', { code: 'MECH-GEN-02', name: 'Motor Overheating', nameAr: 'ارتفاع حرارة المحرك', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-01', { code: 'BB-01', name: 'Piston for powder inlet gate',                  nameAr: 'مكبس بوابة دخول المسحوق',   category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  3 });
  await dc('dc-bb-BB-02', { code: 'BB-02', name: 'Screw piston for opening the powder inlet gate', nameAr: 'مسمار مكبس بوابة المسحوق',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  4 });
  await dc('dc-bb-BB-03', { code: 'BB-03', name: 'Glue tank piston + internal board',             nameAr: 'مكبس خزان الغراء + اللوحة', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  5 });
  await dc('dc-bb-BB-04', { code: 'BB-04', name: 'Glue system complete nozzle',                   nameAr: 'فوهة نظام الغراء الكاملة',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  6 });
  await dc('dc-bb-BB-06', { code: 'BB-06', name: 'Inner holder',                                  nameAr: 'حامل داخلي',                category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  7 });
  await dc('dc-bb-BB-08', { code: 'BB-08', name: 'Inner section cup',                             nameAr: 'كوب القسم الداخلي',         category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  8 });
  await dc('dc-bb-BB-12', { code: 'BB-12', name: 'Rollers drive the inner',                       nameAr: 'بكرات تحريك الجزء الداخلي', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder:  9 });
  await dc('dc-bb-BB-15', { code: 'BB-15', name: 'Chain failure',                                 nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder: 10 });
  await dc('dc-bb-BB-17', { code: 'BB-17', name: 'Printer machine fault',                         nameAr: 'عطل آلة الطباعة',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti,     isPlanned: false, sortOrder: 11 });
  await dc('dc-cm-CM-01', { code: 'CM-01', name: 'Cartomac machine - lower large piston',          nameAr: 'مكبس سفلي كبير - كارتوماك', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 12 });
  await dc('dc-cm-CM-02', { code: 'CM-02', name: 'Carton section cup',                             nameAr: 'كوب قسم الكرتون',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 13 });
  await dc('dc-cm-CM-03', { code: 'CM-03', name: 'Carton closing piston right & left',             nameAr: 'مكبس إغلاق الكرتون Y/Y',    category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 14 });
  await dc('dc-cm-CM-04', { code: 'CM-04', name: 'Fixing piston and fixing track',                 nameAr: 'مكبس التثبيت ومسار التثبيت', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,    isPlanned: false, sortOrder: 15 });
  await dc('dc-cm-CM-05', { code: 'CM-05', name: 'Glue tank piston + internal board',              nameAr: 'مكبس خزان الغراء + اللوحة', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 16 });
  await dc('dc-cm-CM-06', { code: 'CM-06', name: 'Glue system complete nozzle',                    nameAr: 'فوهة نظام الغراء الكاملة',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 17 });
  await dc('dc-cm-CM-09', { code: 'CM-09', name: 'Chain failure',                                  nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 18 });
  await dc('dc-cm-CM-14', { code: 'CM-14', name: 'Printer machine fault',                          nameAr: 'عطل آلة الطباعة',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac,     isPlanned: false, sortOrder: 19 });
  await dc('dc-ep-EP-01', { code: 'EP-01', name: 'Piston and arm for cutting the stretch roll',    nameAr: 'مكبس وذراع قطع الشريط',     category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: euroPackRobot, isPlanned: false, sortOrder: 20 });
  await dc('dc-ep-EP-04', { code: 'EP-04', name: 'Chain failure',                                  nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: euroPackRobot, isPlanned: false, sortOrder: 21 });

  // ── Level 3: Tooling Issues (L2-06) ──
  await dc('dt-l3-tool-001', { code: 'TOOL-01', name: 'Worn Part Past Service Life', nameAr: 'قطعة تجاوزت عمرها الافتراضي', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-tool-002', { code: 'TOOL-02', name: 'Blunt Cutting Blades',        nameAr: 'شفرات قطع باهتة',              category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-tool-003', { code: 'TOOL-03', name: 'Broken Die / Mold',           nameAr: 'قالب مكسور',                   category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Electrical Faults (L2-02) — generic + NCC ──
  await dc('dt-l3-elec-001', { code: 'ELEC-GEN-01', name: 'Blown Fuse',         nameAr: 'فيوز محترق',         category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-elec-002', { code: 'ELEC-GEN-02', name: 'PLC / Control Error', nameAr: 'خطأ في وحدة التحكم', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-05', { code: 'BB-05', name: 'Inverter fault',                        nameAr: 'عطل الإنفرتر',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti,     isPlanned: false, sortOrder: 3 });
  await dc('dc-bb-BB-10', { code: 'BB-10', name: 'Electrical problems',                   nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti,     isPlanned: false, sortOrder: 4 });
  await dc('dc-bb-BB-11', { code: 'BB-11', name: 'Electrical trip for checkweigher belt', nameAr: 'رحلة كهربائية لحزام الموازين', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti,   isPlanned: false, sortOrder: 5 });
  await dc('dc-bb-BB-13', { code: 'BB-13', name: 'Door sensors',                          nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti,     isPlanned: false, sortOrder: 6 });
  await dc('dc-cm-CM-08', { code: 'CM-08', name: 'Door sensors',                          nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: cartomac,     isPlanned: false, sortOrder: 7 });
  await dc('dc-cm-CM-13', { code: 'CM-13', name: 'Electrical problems',                   nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: cartomac,     isPlanned: false, sortOrder: 8 });
  await dc('dc-ep-EP-02', { code: 'EP-02', name: 'Electrical trip for pallet wrapping rotating', nameAr: 'رحلة كهربائية لتغليف البالة', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot, isPlanned: false, sortOrder: 9 });
  await dc('dc-ep-EP-05', { code: 'EP-05', name: 'Door sensors',                          nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot, isPlanned: false, sortOrder: 10 });
  await dc('dc-ep-EP-07', { code: 'EP-07', name: 'Electrical problems',                   nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot, isPlanned: false, sortOrder: 11 });

  // ── Level 3: Setup & Changeovers (L2-03) ──
  await dc('dt-l3-setup-001', { code: 'SETUP-01', name: 'Tooling Swap Delay',     nameAr: 'تأخر تبديل الأدوات', category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-setup-002', { code: 'SETUP-02', name: 'Calibration Adjustment', nameAr: 'ضبط المعايرة',       category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-setup-003', { code: 'SETUP-03', name: 'Cleaning / Sanitation',  nameAr: 'التنظيف / التعقيم',  category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Operator Unavailability (L2-04) ──
  await dc('dt-l3-ops-001', { code: 'OPS-01', name: 'Late Shift Handover',           nameAr: 'تأخر تسليم الوردية', category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-ops-002', { code: 'OPS-02', name: 'Missing Operator / Ghost Shift', nameAr: 'غياب مشغل / وردية وهمية', category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-ops-003', { code: 'OPS-03', name: 'Incorrect Machine Settings',    nameAr: 'إعدادات آلة خاطئة',   category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Lack of Preventive Care (L2-05) ──
  await dc('dt-l3-prev-001', { code: 'PREV-01', name: 'Skipped Scheduled Inspection', nameAr: 'تجاهل الفحص الدوري', category: DowntimeCategory.PROCESS, level: 3, parentId: 'dt-l2-05', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-prev-002', { code: 'PREV-02', name: 'Lack of Lubrication',          nameAr: 'نقص التزييت',        category: DowntimeCategory.PROCESS, level: 3, parentId: 'dt-l2-05', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Logistics / Warehouse (L2-07) — generic + NCC ──
  await dc('dt-l3-log-001', { code: 'LOG-GEN-01', name: 'Wrong Material Delivered', nameAr: 'تسليم مواد خاطئة', category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', isPlanned: false, sortOrder: 1 });
  await dc('dc-bb-BB-16', { code: 'BB-16', name: 'Powder shortage',           nameAr: 'نقص المسحوق',      category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: bigBetti, isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-18', { code: 'BB-18', name: 'Packing material shortage', nameAr: 'نقص مواد التعبئة', category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: bigBetti, isPlanned: false, sortOrder: 3 });
  await dc('dc-cm-CM-10', { code: 'CM-10', name: 'Packing material shortage', nameAr: 'نقص مواد التعبئة', category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: cartomac, isPlanned: false, sortOrder: 4 });

  // ── Level 3: Quality Inspection Hold (L2-08) ──
  await dc('dt-l3-qa-001', { code: 'QA-01', name: 'Waiting for QA Release',           nameAr: 'انتظار إفراج الجودة', category: DowntimeCategory.QUALITY, level: 3, parentId: 'dt-l2-08', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-qa-002', { code: 'QA-02', name: 'Defective Raw Material Rejection', nameAr: 'رفض مواد خام معيبة',  category: DowntimeCategory.QUALITY, level: 3, parentId: 'dt-l2-08', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Power & Pneumatics (L2-09) — generic + NCC ──
  await dc('dt-l3-pwr-001', { code: 'PWR-GEN-01', name: 'Localized Voltage Spike', nameAr: 'ارتفاع جهد موضعي', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', isPlanned: false, sortOrder: 1 });
  await dc('dc-bb-BB-07', { code: 'BB-07', name: 'Air pressure low',   nameAr: 'ضغط الهواء منخفض',      category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: bigBetti,     isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-14', { code: 'BB-14', name: 'Main power failure', nameAr: 'انقطاع الطاقة الرئيسي', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: bigBetti,     isPlanned: false, sortOrder: 3 });
  await dc('dc-cm-CM-11', { code: 'CM-11', name: 'Main power failure', nameAr: 'انقطاع الطاقة الرئيسي', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: cartomac,     isPlanned: false, sortOrder: 4 });
  await dc('dc-cm-CM-12', { code: 'CM-12', name: 'Air pressure low',   nameAr: 'ضغط الهواء منخفض',      category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: cartomac,     isPlanned: false, sortOrder: 5 });
  await dc('dc-ep-EP-06', { code: 'EP-06', name: 'Air pressure low',   nameAr: 'ضغط الهواء منخفض',      category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: euroPackRobot, isPlanned: false, sortOrder: 6 });
  await dc('dc-ep-EP-08', { code: 'EP-08', name: 'Main power failure', nameAr: 'انقطاع الطاقة الرئيسي', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', machineId: euroPackRobot, isPlanned: false, sortOrder: 7 });

  // ── Level 3: IT & Connectivity (L2-10) ──
  await dc('dt-l3-it-001', { code: 'IT-01', name: 'Network Disruption / Internet Down', nameAr: 'انقطاع الشبكة / الإنترنت', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-10', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-it-002', { code: 'IT-02', name: 'Software Freeze / Server Crash',     nameAr: 'تجمد البرنامج / انهيار الخادم', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-10', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Environmental & HVAC (L2-11) — generic + NCC ──
  await dc('dt-l3-hvac-001', { code: 'HVAC-GEN-01', name: 'Temperature Out of Range', nameAr: 'درجة حرارة خارج النطاق', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', isPlanned: false, sortOrder: 1 });
  await dc('dc-bb-BB-09', { code: 'BB-09', name: 'A/C failure', nameAr: 'عطل التكييف', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: bigBetti,     isPlanned: false, sortOrder: 2 });
  await dc('dc-cm-CM-07', { code: 'CM-07', name: 'A/C failure', nameAr: 'عطل التكييف', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: cartomac,     isPlanned: false, sortOrder: 3 });
  await dc('dc-ep-EP-03', { code: 'EP-03', name: 'A/C failure', nameAr: 'عطل التكييف', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: euroPackRobot, isPlanned: false, sortOrder: 4 });

  // ── Level 3: Scheduled Breaks & Cleaning (L2-12) ──
  await dc('dc-pln-PLN-01', { code: 'PLN-01', name: 'Planned break',      nameAr: 'استراحة مجدولة',   category: DowntimeCategory.PLANNED_BREAK,       level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 1 });
  await dc('dc-pln-PLN-02', { code: 'PLN-02', name: 'Planned cleaning',   nameAr: 'تنظيف مجدول',      category: DowntimeCategory.PLANNED_CLEANING,    level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 2 });
  await dc('dc-pln-PLN-05', { code: 'PLN-05', name: 'Scheduled shutdown', nameAr: 'إيقاف تشغيل مجدول', category: DowntimeCategory.PLANNED_MAINTENANCE, level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 3 });

  // ── Level 3: Planned Maintenance & Changeover (L2-13) ──
  await dc('dc-pln-PLN-04', { code: 'PLN-04', name: 'Preventive maintenance', nameAr: 'صيانة وقائية', category: DowntimeCategory.PLANNED_MAINTENANCE, level: 3, parentId: 'dt-l2-13', isPlanned: true, sortOrder: 1 });
  await dc('dc-pln-PLN-03', { code: 'PLN-03', name: 'Product changeover',     nameAr: 'تحويل المنتج', category: DowntimeCategory.CHANGEOVER,          level: 3, parentId: 'dt-l2-13', isPlanned: true, sortOrder: 2 });

  // ── Cleanup: remove leftover flat / synthetic causes from earlier seeds ──
  const stale = await prisma.downtimeCause.findMany({
    where: { factoryId, id: { notIn: [...keptIds] } },
    select: { id: true },
  });
  if (stale.length) {
    const ids = stale.map((s) => s.id);
    // Null references first so the FK stays valid, then delete.
    await prisma.downtimeEvent.updateMany({ where: { causeId: { in: ids } }, data: { causeId: null } });
    await prisma.machineStateRecord.updateMany({ where: { downtimeCauseId: { in: ids } }, data: { downtimeCauseId: null } });
    // children-before-parents (sort by level desc) to avoid FK on self-relation
    const ordered = await prisma.downtimeCause.findMany({ where: { id: { in: ids } }, orderBy: { level: 'desc' }, select: { id: true } });
    for (const c of ordered) await prisma.downtimeCause.delete({ where: { id: c.id } }).catch(() => undefined);
  }

  console.log(`✓ NCC downtime reason tree applied: ${keptIds.size} nodes (6 L1, 13 L2, ~50 L3). Removed ${stale.length} stale causes.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
