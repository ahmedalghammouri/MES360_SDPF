// ============================================================
// MES360° Platform — Database Seed
// NCC (National Care Company) — Real Factory Data
// Based on NCC Prerequisites File & Requirements Matrix
// ============================================================

import { PrismaClient, UserRole, MachineType, Criticality, AreaType, LineType, DowntimeCategory, MaintType, EnergyType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedDashboardCenter } from './seeds/dashboard-center.seed';
import { seedIotEnergyDemo } from './seeds/iot-energy-demo';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding MES360° Platform — NCC Group...\n');

  const passwordHash = await bcrypt.hash('Password@123', 12);

  // ============================================================
  // ENTERPRISE — National Care Company
  // ============================================================
  const enterprise = await prisma.enterprise.upsert({
    where: { code: 'NCC' },
    update: {},
    create: {
      code: 'NCC',
      name: 'National Care Company',
      nameAr: 'شركة الرعاية الوطنية',
      industry: 'FMCG — Detergents & Personal Care',
      country: 'SA',
      timezone: 'Asia/Riyadh',
      currency: 'SAR',
      language: 'en',
    },
  });
  console.log(`✅ Enterprise: ${enterprise.name}`);

  // ============================================================
  // SUPER ADMIN USER
  // ============================================================
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@mes360.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: null,
      email: 'admin@mes360.sa',
      name: 'System Administrator',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      department: 'IT',
      jobTitle: 'Platform Administrator',
      language: 'en',
      timezone: 'Asia/Riyadh',
    },
  });
  console.log(`✅ Super Admin: ${superAdmin.email}`);

  const platformUser = await prisma.user.upsert({
    where: { email: 'soliman@mes360.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: null,
      email: 'soliman@mes360.sa',
      name: 'Soliman Al-Rashid',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      department: 'Operations',
      jobTitle: 'MES Platform Manager',
    },
  });
  console.log(`✅ Platform Manager: ${platformUser.email}`);

  // ============================================================
  // FACTORY 1 — SDPF (Saudi Detergent Powder Factory)
  // 3rd Industrial City, Dammam
  // ============================================================
  const sdpf = await prisma.factory.upsert({
    where: { code: 'SDPF' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      code: 'SDPF',
      name: 'Saudi Detergent Powder Factory',
      nameAr: 'مصنع المنظفات السعودية',
      city: 'Dammam',
      country: 'SA',
      address: '3rd Industrial City, Dammam, Eastern Province',
      lat: 25.9267784, // maps.app.goo.gl/PYQT8hM7hsVLnuV18
      lng: 49.9469883,
      color: '#00C8FF',
      glowColor: 'rgba(0,200,255,0.3)',
      timezone: 'Asia/Riyadh',
    },
  });

  // ============================================================
  // FACTORY 2 — SAF (Saudi Aerosol Factory)
  // 3rd Industrial City, Dammam
  // ============================================================
  const saf = await prisma.factory.upsert({
    where: { code: 'SAF' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      code: 'SAF',
      name: 'Saudi Aerosol Factory',
      nameAr: 'مصنع المنظفات الجوية',
      city: 'Dammam',
      country: 'SA',
      address: '3rd Industrial City, Dammam, Eastern Province',
      lat: 25.9265816, // maps.app.goo.gl/m8po6Ysbv1AoAiqS7 — 'SIDCO Aerosol Factory'
      lng: 49.9448726,
      color: '#FF6B35',
      glowColor: 'rgba(255,107,53,0.3)',
      timezone: 'Asia/Riyadh',
    },
  });

  // ============================================================
  // FACTORY 3 — NDPF (National Detergent Powder Factory)
  // Jeddah, Makkah Province (client-supplied location, 30-07-2026)
  // ============================================================
  const ndpf = await prisma.factory.upsert({
    where: { code: 'NDPF' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      code: 'NDPF',
      name: 'National Detergent Powder Factory',
      nameAr: 'المصنع الوطني للمنظفات',
      city: 'Jeddah',
      country: 'SA',
      address: 'Jeddah, Makkah Province',
      lat: 21.4112773, // maps.app.goo.gl/bSRxZDGSTE29uzND9 — was Dammam, please confirm
      lng: 39.2425602,
      color: '#9B59B6',
      glowColor: 'rgba(155,89,182,0.3)',
      timezone: 'Asia/Riyadh',
    },
  });

  // ============================================================
  // FACTORY 4 — SIDCO (Saudi Industrial Detergent Co.) — PoC FACTORY
  // 2nd Industrial City, Dammam
  // ============================================================
  const sidco = await prisma.factory.upsert({
    where: { code: 'SIDCO' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      code: 'SIDCO',
      name: 'Saudi Industrial Detergent Company',
      nameAr: 'الشركة السعودية الصناعية للمنظفات',
      city: 'Dammam',
      country: 'SA',
      address: '2nd Industrial City, Dammam 34326, Eastern Province',
      lat: 26.2539087, // maps.app.goo.gl/eQPmPB48CgjsSj34A
      lng: 49.9876848,
      color: '#2ECC71',
      glowColor: 'rgba(46,204,113,0.3)',
      timezone: 'Asia/Riyadh',
    },
  });

  // ============================================================
  // FACTORY 5 — RNTIC (Plastic Blow Molding)
  // 2nd Industrial City, Dammam (client-supplied location, 30-07-2026)
  // ============================================================
  const rntic = await prisma.factory.upsert({
    where: { code: 'RNTIC' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      code: 'RNTIC',
      name: 'Plastic Blow Molding Manufacturing',
      nameAr: 'مصنع تشكيل البلاستيك بالنفخ',
      city: 'Dammam',
      country: 'SA',
      address: '2nd Industrial City, Dammam 34326, Eastern Province',
      lat: 26.2524912, // maps.app.goo.gl/N9GvhpLf3tyyhM4JA — was Jeddah, please confirm
      lng: 49.9857344,
      color: '#E74C3C',
      glowColor: 'rgba(231,76,60,0.3)',
      timezone: 'Asia/Riyadh',
    },
  });

  console.log(`✅ Factories: SDPF, SAF, NDPF, SIDCO (PoC), RNTIC`);

  // ============================================================
  // SIDCO — AREAS (ISA-95 Level 3)
  // Based on Factory Automation Matrix: MAKING, PACKING, UTILITY
  // ============================================================
  const sidcoPackingArea = await prisma.area.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'PACKING' } },
    update: {},
    create: {
      factoryId: sidco.id,
      code: 'PACKING',
      name: 'Packing Area',
      nameAr: 'منطقة التعبئة',
      type: AreaType.PACKING,
    },
  });

  const sidcoMakingArea = await prisma.area.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'MAKING' } },
    update: {},
    create: {
      factoryId: sidco.id,
      code: 'MAKING',
      name: 'Making / Production Area',
      nameAr: 'منطقة الإنتاج',
      type: AreaType.MAKING,
    },
  });

  const sidcoUtilityArea = await prisma.area.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'UTILITY' } },
    update: {},
    create: {
      factoryId: sidco.id,
      code: 'UTILITY',
      name: 'Utility & Infrastructure',
      nameAr: 'منطقة المرافق',
      type: AreaType.UTILITY,
    },
  });

  // ============================================================
  // SIDCO — PRODUCTION LINE (Packing Line 1)
  // Based on Prerequisites: 5 machines in sequence
  // ============================================================
  const sidcoPackingLine1 = await prisma.productionLine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'PL-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      code: 'PL-01',
      name: 'Packing Line 1',
      nameAr: 'خط التعبئة 1',
      type: LineType.PACKING,
      sortOrder: 1,
    },
  });

  // ============================================================
  // SIDCO — MACHINES (ISA-95 Level 2)
  // Real NCC machine names from Prerequisites File — DB sort order:
  // M1=Big Betti, M2=Checkweigher, M3=Cartomac, M4=Euro-Pack Robot, M5=Uni-tech Wrapping
  // ============================================================

  // Migrate any legacy code assignment (old seeds had M2=Cartomac / M3=Checkweigher)
  const legacyCartomac = await prisma.machine.findFirst({ where: { factoryId: sidco.id, code: 'M2-CARTOMAC' } });
  if (legacyCartomac) {
    await prisma.machine.update({ where: { id: legacyCartomac.id }, data: { code: 'TMP-M3-SWAP' } });
    await prisma.machine.updateMany({ where: { factoryId: sidco.id, code: 'M3-CHECKWEIGHER' }, data: { code: 'M2-CHECKWEIGHER', sortOrder: 2 } });
    await prisma.machine.update({ where: { id: legacyCartomac.id }, data: { code: 'M3-CARTOMAC', sortOrder: 3 } });
  }

  const bigBetti = await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'M1-BIG-BETTI' } },
    update: { sortOrder: 1 },
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      lineId: sidcoPackingLine1.id,
      code: 'M1-BIG-BETTI',
      name: 'Big Betti',
      nameAr: 'ماكينة بيج بيتي',
      sortOrder: 1,
      machineType: MachineType.FILLING_MACHINE,
      manufacturer: 'Big Betti GmbH',
      criticality: Criticality.CRITICAL,
      designCapacity: 120,    // units per hour (approx based on cycle times)
      downtimeThreshold: 60,  // 1 minute = NCC spec
    },
  });

  const checkweigher = await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'M2-CHECKWEIGHER' } },
    update: { sortOrder: 2 },
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      lineId: sidcoPackingLine1.id,
      code: 'M2-CHECKWEIGHER',
      name: 'Checkweigher',
      nameAr: 'جهاز فحص الوزن',
      sortOrder: 2,
      machineType: MachineType.CHECKWEIGHER,
      criticality: Criticality.HIGH,
      downtimeThreshold: 60,
    },
  });

  const cartomac = await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'M3-CARTOMAC' } },
    update: { sortOrder: 3 },
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      lineId: sidcoPackingLine1.id,
      code: 'M3-CARTOMAC',
      name: 'Cartomac',
      nameAr: 'ماكينة كارتوماك',
      sortOrder: 3,
      machineType: MachineType.CARTONING_MACHINE,
      manufacturer: 'Cartomac S.r.l.',
      criticality: Criticality.CRITICAL,
      designCapacity: 45 * 2 * 60,  // 45 duplex/min = 5400 cartons/hr
      downtimeThreshold: 60,
    },
  });

  const euroPackRobot = await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'M4-EURO-PACK' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      lineId: sidcoPackingLine1.id,
      code: 'M4-EURO-PACK',
      name: 'Euro-Pack Robot',
      nameAr: 'روبوت يورو-باك',
      sortOrder: 4,
      machineType: MachineType.ROBOT,
      manufacturer: 'Euro-Pack Systems',
      criticality: Criticality.HIGH,
      downtimeThreshold: 60,
    },
  });

  const unitechWrapping = await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'M5-UNITECH' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoPackingArea.id,
      lineId: sidcoPackingLine1.id,
      code: 'M5-UNITECH',
      name: 'Uni-tech Wrapping',
      nameAr: 'ماكينة يوني-تك للتغليف',
      sortOrder: 5,
      machineType: MachineType.WRAPPING_MACHINE,
      manufacturer: 'Uni-tech',
      criticality: Criticality.HIGH,
      downtimeThreshold: 60,
    },
  });

  // Utility machines
  await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'UTIL-BOILER-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoUtilityArea.id,
      code: 'UTIL-BOILER-01',
      name: 'Boiler',
      nameAr: 'غلاية البخار',
      sortOrder: 1,
      machineType: MachineType.BOILER,
      criticality: Criticality.CRITICAL,
    },
  });

  await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'UTIL-COMP-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoUtilityArea.id,
      code: 'UTIL-COMP-01',
      name: 'Compressor 1',
      nameAr: 'الضاغط 1',
      sortOrder: 2,
      machineType: MachineType.COMPRESSOR,
      criticality: Criticality.HIGH,
    },
  });

  await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'UTIL-COMP-02' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoUtilityArea.id,
      code: 'UTIL-COMP-02',
      name: 'Compressor 2',
      nameAr: 'الضاغط 2',
      sortOrder: 3,
      machineType: MachineType.COMPRESSOR,
      criticality: Criticality.HIGH,
    },
  });

  await prisma.machine.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'UTIL-TRANS-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      areaId: sidcoUtilityArea.id,
      code: 'UTIL-TRANS-01',
      name: 'ACB | Transformer 1',
      nameAr: 'محول الكهرباء 1',
      sortOrder: 4,
      machineType: MachineType.TRANSFORMER,
      criticality: Criticality.CRITICAL,
    },
  });

  console.log(`✅ SIDCO machines: Big Betti, Cartomac, Checkweigher, Euro-Pack Robot, Uni-tech, Utilities`);

  // Init machine status snapshots
  const machines = [bigBetti, cartomac, checkweigher, euroPackRobot, unitechWrapping];
  for (const m of machines) {
    await prisma.machineCurrentStatus.upsert({
      where: { machineId: m.id },
      update: {},
      create: {
        machineId: m.id,
        state: 'IDLE',
        goodCount: 0,
        rejectCount: 0,
        downtimeMinutes: 0,
        runtimeMinutes: 0,
      },
    });
  }

  // ============================================================
  // SIDCO — SHIFT TEMPLATES
  // From Prerequisites: 2 × 12-hour shifts, 11h production, 1h breaks
  // Shift 1: 07:30–19:30 | Shift 2: 19:30–07:30
  // Working days: Saturday–Thursday (days 0,1,2,3,4,6 in JS: 0=Sun)
  // ============================================================
  const shift1 = await prisma.shiftTemplate.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'S1' } },
    update: { targetQtyPerShift: 3000 },
    create: {
      factoryId: sidco.id,
      code: 'S1',
      name: 'Day Shift',
      nameAr: 'الوردية الصباحية',
      startTime: '07:30',
      endTime: '19:30',
      crossesMidnight: false,
      plannedProductionHours: 11.0,
      shiftDurationHours: 12.0,
      breakMinutes: 30,
      cleaningMinutes: 30,
      days: [0, 1, 2, 3, 4, 6], // Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Sat=6
      targetQtyPerShift: 3000, // NCC: 3000–3500 boxes/shift
    },
  });

  const shift2 = await prisma.shiftTemplate.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'S2' } },
    update: { targetQtyPerShift: 3000 },
    create: {
      factoryId: sidco.id,
      code: 'S2',
      name: 'Night Shift',
      nameAr: 'الوردية الليلية',
      startTime: '19:30',
      endTime: '07:30',
      crossesMidnight: true,
      plannedProductionHours: 11.0,
      shiftDurationHours: 12.0,
      breakMinutes: 30,
      cleaningMinutes: 30,
      days: [0, 1, 2, 3, 4, 6],
      targetQtyPerShift: 3000,
    },
  });
  console.log(`✅ SIDCO shifts: Day (07:30-19:30), Night (19:30-07:30), 11h production / 12h total`);

  // ============================================================
  // SIDCO — SKUs / PRODUCTS
  // Real item numbers from NCC Prerequisites File
  // ============================================================
  const skuData = [
    // Alwatani brand
    { itemNumber: '10310064', name: 'Alwatani Powder Detergent - Violet HF', brand: 'Alwatani', category: 'Powder Detergent', weight: 2.0, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310067', name: 'Alwatani Powder Detergent - Blue HF', brand: 'Alwatani', category: 'Powder Detergent', weight: 2.0, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    // SIDCO Extra White
    { itemNumber: '10310110', name: 'SIDCO EXtra White - Original HF', brand: 'SIDCO Extra White', category: 'Powder Detergent', weight: 1.5, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310111', name: 'SIDCO EXtra White - Flower HF', brand: 'SIDCO Extra White', category: 'Powder Detergent', weight: 1.5, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310112', name: 'SIDCO EXtra White - Jasmine HF', brand: 'SIDCO Extra White', category: 'Powder Detergent', weight: 1.5, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310113', name: 'SIDCO EXtra White - Original LF', brand: 'SIDCO Extra White', category: 'Powder Detergent', weight: 1.5, packagingType: 'LF', unitsPerInner: 6, innersPerCarton: 1 },
    // GENTO 2.25kg
    { itemNumber: '10310189', name: 'GENTO - Flower HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310190', name: 'GENTO - Oud HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310191', name: 'GENTO - Original HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310192', name: 'GENTO Green - Flower LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310193', name: 'GENTO Green - Oud LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310194', name: 'GENTO Green - Original LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310217', name: 'GENTO - Musk HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310218', name: 'GENTO - Elegant HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310219', name: 'GENTO Green - Musk LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310220', name: 'GENTO Green - Elegant LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310235', name: 'GENTO - Gold HF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310236', name: 'GENTO - Gold LF 2.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    // GENTO 1.25kg
    { itemNumber: '10310201', name: 'GENTO - Original HF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310202', name: 'GENTO - Flower HF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310203', name: 'GENTO - Oud HF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310204', name: 'GENTO - Original LF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'LF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310205', name: 'GENTO - Flower LF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'LF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310206', name: 'GENTO - Oud LF 1.25kg', brand: 'GENTO', category: 'Powder Detergent', weight: 1.25, packagingType: 'LF', unitsPerInner: 6, innersPerCarton: 1 },
    // Safe
    { itemNumber: '10310213', name: 'Safe - Flower HF 2.25kg', brand: 'Safe', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310214', name: 'Safe - Original HF 2.25kg', brand: 'Safe', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310215', name: 'Safe - Flower LF 2.25kg', brand: 'Safe', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310216', name: 'Safe - Original LF 2.25kg', brand: 'Safe', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    // Miza / Panda
    { itemNumber: '10310290', name: 'Miza (Panda) HF 2.25kg', brand: 'Miza', category: 'Powder Detergent', weight: 2.25, packagingType: 'HF', unitsPerInner: 4, innersPerCarton: 1 },
    { itemNumber: '10310291', name: 'Miza (Panda) LF 2.25kg', brand: 'Miza', category: 'Powder Detergent', weight: 2.25, packagingType: 'LF', unitsPerInner: 4, innersPerCarton: 1 },
    // Rex
    { itemNumber: '10310297', name: 'Rex HF 2.5kg', brand: 'REX', category: 'Powder Detergent', weight: 2.5, packagingType: 'HF', unitsPerInner: 6, innersPerCarton: 1 },
    { itemNumber: '10310298', name: 'REX LF 2.5kg', brand: 'REX', category: 'Powder Detergent', weight: 2.5, packagingType: 'LF', unitsPerInner: 6, innersPerCarton: 1 },
  ];

  const skuMap: Record<string, string> = {};
  for (const s of skuData) {
    const sku = await prisma.sKU.upsert({
      where: { factoryId_itemNumber: { factoryId: sidco.id, itemNumber: s.itemNumber } },
      update: {},
      create: {
        factoryId: sidco.id,
        itemNumber: s.itemNumber,
        code: `SKU-${s.itemNumber}`,
        name: s.name,
        brand: s.brand,
        category: s.category,
        weight: s.weight,
        weightUnit: 'kg',
        packagingType: s.packagingType,
        unitsPerInner: s.unitsPerInner,
        innersPerCarton: s.innersPerCarton,
        cartonsPerPallet: 40,
        baseUnit: 'CARTON',
      },
    });
    skuMap[s.itemNumber] = sku.id;
  }
  console.log(`✅ SIDCO SKUs: ${skuData.length} products loaded`);

  // ============================================================
  // SIDCO — PRODUCT MASTER DATA (NCC metadata → managed lookups)
  // Category / Brand / Packaging Type / Base Unit / Base Weight
  // ============================================================

  const masterCategory = await prisma.productCategory.upsert({
    where: { factoryId_name: { factoryId: sidco.id, name: 'Powder Detergent' } },
    update: {},
    create: { factoryId: sidco.id, name: 'Powder Detergent', nameAr: 'مسحوق منظفات', sortOrder: 1 },
  });

  const brandIds: Record<string, string> = {};
  const brandNames = Array.from(new Set(skuData.map((s) => s.brand)));
  for (let i = 0; i < brandNames.length; i++) {
    const b = await prisma.productBrand.upsert({
      where: { factoryId_name: { factoryId: sidco.id, name: brandNames[i] } },
      update: {},
      create: { factoryId: sidco.id, name: brandNames[i], sortOrder: i + 1 },
    });
    brandIds[brandNames[i]] = b.id;
  }

  const packTypeIds: Record<string, string> = {};
  const packTypes = [
    { name: 'HF', nameAr: 'رغوة عالية' },   // High Foam
    { name: 'LF', nameAr: 'رغوة منخفضة' },  // Low Foam
  ];
  for (let i = 0; i < packTypes.length; i++) {
    const p = await prisma.packagingType.upsert({
      where: { factoryId_name: { factoryId: sidco.id, name: packTypes[i].name } },
      update: {},
      create: { factoryId: sidco.id, name: packTypes[i].name, nameAr: packTypes[i].nameAr, sortOrder: i + 1 },
    });
    packTypeIds[packTypes[i].name] = p.id;
  }

  const baseUnitIds: Record<string, string> = {};
  const baseUnits = [
    { code: 'PCS', name: 'Pieces' },
    { code: 'INNER', name: 'Inner Bag' },
    { code: 'CARTON', name: 'Carton' },
    { code: 'PALLET', name: 'Pallet' },
  ];
  for (let i = 0; i < baseUnits.length; i++) {
    const u = await prisma.baseUnit.upsert({
      where: { factoryId_code: { factoryId: sidco.id, code: baseUnits[i].code } },
      update: {},
      create: { factoryId: sidco.id, code: baseUnits[i].code, name: baseUnits[i].name, sortOrder: i + 1 },
    });
    baseUnitIds[baseUnits[i].code] = u.id;
  }

  const baseWeightIds: Record<string, string> = {};
  const baseWeightVals = Array.from(new Set(skuData.map((s) => s.weight))).sort((a, b) => a - b);
  for (const w of baseWeightVals) {
    const bw = await prisma.baseWeight.upsert({
      where: { factoryId_value_unit: { factoryId: sidco.id, value: w, unit: 'kg' } },
      update: {},
      create: { factoryId: sidco.id, value: w, unit: 'kg', label: `${w} Kg`, sortOrder: Math.round(w * 100) },
    });
    baseWeightIds[String(w)] = bw.id;
  }

  // Link every SKU to its master-data records (FK ids + keep legacy strings in sync)
  for (const s of skuData) {
    await prisma.sKU.update({
      where: { factoryId_itemNumber: { factoryId: sidco.id, itemNumber: s.itemNumber } },
      data: {
        categoryId: masterCategory.id,
        category: 'Powder Detergent',
        brandId: brandIds[s.brand],
        brand: s.brand,
        packagingTypeId: packTypeIds[s.packagingType] ?? null,
        packagingType: s.packagingType,
        baseUnitId: baseUnitIds['CARTON'],
        baseUnit: 'CARTON',
        baseWeightId: baseWeightIds[String(s.weight)] ?? null,
        weight: s.weight,
        weightUnit: 'kg',
      },
    });
  }
  console.log(`✅ SIDCO product master data: 1 category, ${brandNames.length} brands, ${packTypes.length} packaging types, ${baseUnits.length} base units, ${baseWeightVals.length} base weights — all ${skuData.length} SKUs linked`);

  // ============================================================
  // SIDCO — UNIFIED UNITS OF MEASURE (canonical units + conversions)
  // Single source of truth for units on raw materials, BOM lines,
  // routing-step materials and material lots.
  // ============================================================
  const uomDefs: Array<{ code: string; name: string; nameAr?: string; category: 'WEIGHT' | 'VOLUME' | 'COUNT' | 'PACKAGING' | 'LENGTH'; baseUnitCode?: string; factor?: number; decimals?: number }> = [
    { code: 'KG', name: 'Kilogram', nameAr: 'كيلوجرام', category: 'WEIGHT', baseUnitCode: 'KG', factor: 1 },
    { code: 'G', name: 'Gram', nameAr: 'جرام', category: 'WEIGHT', baseUnitCode: 'KG', factor: 0.001 },
    { code: 'TON', name: 'Metric Ton', nameAr: 'طن', category: 'WEIGHT', baseUnitCode: 'KG', factor: 1000 },
    { code: 'L', name: 'Liter', nameAr: 'لتر', category: 'VOLUME', baseUnitCode: 'L', factor: 1 },
    { code: 'ML', name: 'Milliliter', nameAr: 'مليلتر', category: 'VOLUME', baseUnitCode: 'L', factor: 0.001 },
    { code: 'PCS', name: 'Pieces', nameAr: 'قطعة', category: 'COUNT', baseUnitCode: 'PCS', factor: 1, decimals: 0 },
    { code: 'EA', name: 'Each', category: 'COUNT', baseUnitCode: 'PCS', factor: 1, decimals: 0 },
    { code: 'ROLL', name: 'Roll', nameAr: 'لفة', category: 'COUNT', baseUnitCode: 'PCS', factor: 1, decimals: 0 },
    { code: 'INNER', name: 'Inner Bag', nameAr: 'كيس داخلي', category: 'PACKAGING', decimals: 0 },
    { code: 'CARTON', name: 'Carton', nameAr: 'كرتونة', category: 'PACKAGING', decimals: 0 },
    { code: 'PALLET', name: 'Pallet', nameAr: 'طبلية', category: 'PACKAGING', decimals: 0 },
    { code: 'M', name: 'Meter', nameAr: 'متر', category: 'LENGTH', baseUnitCode: 'M', factor: 1 },
  ];
  const uomIds: Record<string, string> = {};
  for (let i = 0; i < uomDefs.length; i++) {
    const u = uomDefs[i];
    const row = await prisma.unitOfMeasure.upsert({
      where: { factoryId_code: { factoryId: sidco.id, code: u.code } },
      update: { category: u.category as any, baseUnitCode: u.baseUnitCode ?? null, conversionFactor: u.factor ?? 1 },
      create: {
        factoryId: sidco.id, code: u.code, name: u.name, nameAr: u.nameAr ?? null,
        category: u.category as any, baseUnitCode: u.baseUnitCode ?? null,
        conversionFactor: u.factor ?? 1, decimals: u.decimals ?? 3, sortOrder: i + 1,
      },
    });
    uomIds[u.code] = row.id;
  }

  // Backfill unitId FKs from legacy unit strings (idempotent — only rows still null)
  const normUnit = (raw: string): string | null => {
    const x = (raw || '').trim().toUpperCase();
    if (uomIds[x]) return x;
    if (x === 'KGS' || x === 'KILOGRAM') return 'KG';
    if (x === 'PIECE' || x === 'PIECES' || x === 'UNIT') return 'PCS';
    if (x === 'LTR' || x === 'LITER') return 'L';
    return null;
  };
  for (const table of ['rawMaterial', 'materialLot', 'routingStepMaterial', 'bOMItem'] as const) {
    const delegate = prisma[table] as any;
    const pending = await delegate.findMany({ where: { unitId: null }, select: { id: true, unit: true } });
    for (const row of pending) {
      const code = normUnit(row.unit);
      if (code) await delegate.update({ where: { id: row.id }, data: { unitId: uomIds[code] } });
    }
  }

  // Backfill MaterialLot.rawMaterialId by materialCode (traceability joins need the FK)
  const orphanLots = await prisma.materialLot.findMany({ where: { rawMaterialId: null }, select: { id: true, materialCode: true, factoryId: true } });
  for (const lot of orphanLots) {
    const rm = await prisma.rawMaterial.findFirst({ where: { factoryId: lot.factoryId, code: lot.materialCode } });
    if (rm) await prisma.materialLot.update({ where: { id: lot.id }, data: { rawMaterialId: rm.id } });
  }

  // Backfill RoutingStepMachineOption: every step's current machine becomes the primary option
  const stepsWithMachine = await prisma.routingStep.findMany({ where: { machineId: { not: null } }, select: { id: true, machineId: true } });
  for (const st of stepsWithMachine) {
    await prisma.routingStepMachineOption.upsert({
      where: { stepId_machineId: { stepId: st.id, machineId: st.machineId! } },
      update: { isDefault: true, priority: 0 },
      create: { stepId: st.id, machineId: st.machineId!, priority: 0, isDefault: true },
    });
  }
  console.log(`✅ Units of measure: ${uomDefs.length} seeded; unit FKs backfilled; ${stepsWithMachine.length} primary machine options ensured`);

  // ============================================================
  // SIDCO — MACHINE CYCLE TIMES (from NCC Prerequisites)
  // Big Betti (M1): 1.5kg=30s, 2kg=31s, 2.25kg=35s per INNER
  // Cartomac (M2): 1.5kg=30s, 2kg=25s, 2.25kg=40s per CARTON
  // Euro-Pack Robot (M4): 1.5kg=7m50s, 2kg=4m50s, 2.25kg=4m35s per PALLET
  // Uni-tech Wrapping (M5): 1.5kg=2m50s, 2kg=2m25s, 2.25kg=2m30s per PALLET
  // ============================================================
  const weightGroups: Record<string, string[]> = {
    '1.5': ['10310110', '10310111', '10310112', '10310113', '10310201', '10310202', '10310203', '10310204', '10310205', '10310206'],
    '2.0': ['10310064', '10310067'],
    '2.25': ['10310189', '10310190', '10310191', '10310192', '10310193', '10310194', '10310213', '10310214', '10310215', '10310216', '10310217', '10310218', '10310219', '10310220', '10310235', '10310236', '10310290', '10310291'],
    '2.5': ['10310297', '10310298'],
  };

  // Big Betti cycle times (per INNER)
  const bigBettiCycles: Record<string, number> = { '1.5': 30, '2.0': 31, '2.25': 35, '2.5': 36 };
  // Cartomac cycle times (per CARTON) — 45 duplex/min = each carton ~1.33s but NCC gave: 1.5kg=30s, 2kg=25s, 2.25kg=40s
  const cartomacCycles: Record<string, number> = { '1.5': 30, '2.0': 25, '2.25': 40, '2.5': 30 };
  // Euro-Pack Robot (per PALLET in seconds)
  const euroPackCycles: Record<string, number> = { '1.5': 470, '2.0': 290, '2.25': 275, '2.5': 300 }; // 7m50s=470, 4m50s=290, 4m35s=275
  // Uni-tech Wrapping (per PALLET)
  const unitechCycles: Record<string, number> = { '1.5': 170, '2.0': 145, '2.25': 150, '2.5': 155 }; // 2m50s=170, 2m25s=145, 2m30s=150

  for (const [weight, itemNumbers] of Object.entries(weightGroups)) {
    for (const itemNo of itemNumbers) {
      const skuId = skuMap[itemNo];
      if (!skuId) continue;

      if (bigBettiCycles[weight]) {
        await prisma.machineCycleTime.upsert({
          where: { machineId_skuId_unitType: { machineId: bigBetti.id, skuId, unitType: 'INNER' } },
          update: {},
          create: { machineId: bigBetti.id, skuId, cycleTimeSeconds: bigBettiCycles[weight], unitType: 'INNER' },
        });
      }
      if (cartomacCycles[weight]) {
        await prisma.machineCycleTime.upsert({
          where: { machineId_skuId_unitType: { machineId: cartomac.id, skuId, unitType: 'CARTON' } },
          update: {},
          create: { machineId: cartomac.id, skuId, cycleTimeSeconds: cartomacCycles[weight], unitType: 'CARTON', maxSpeed: 45 * 2 },
        });
      }
      if (euroPackCycles[weight]) {
        await prisma.machineCycleTime.upsert({
          where: { machineId_skuId_unitType: { machineId: euroPackRobot.id, skuId, unitType: 'PALLET' } },
          update: {},
          create: { machineId: euroPackRobot.id, skuId, cycleTimeSeconds: euroPackCycles[weight], unitType: 'PALLET' },
        });
      }
      if (unitechCycles[weight]) {
        await prisma.machineCycleTime.upsert({
          where: { machineId_skuId_unitType: { machineId: unitechWrapping.id, skuId, unitType: 'PALLET' } },
          update: {},
          create: { machineId: unitechWrapping.id, skuId, cycleTimeSeconds: unitechCycles[weight], unitType: 'PALLET' },
        });
      }
    }
  }
  console.log(`✅ Cycle times loaded for all SKU × Machine combinations`);

  // ============================================================
  // SIDCO — DOWNTIME CAUSES  (3-Level Tree: Standard + NCC)
  // Level 1 = Top category | Level 2 = Sub-category | Level 3 = Specific reason (leaf)
  // ============================================================

  const dc = async (id: string, data: Record<string, unknown>) => {
    await prisma.downtimeCause.upsert({
      where: { id },
      update: { level: (data.level as number) ?? 3, parentId: (data.parentId as string | null) ?? null },
      create: { id, factoryId: sidco.id, ...(data as any) },
    });
  };

  // ── Level 1 ─────────────────────────────────────────────────
  await dc('dt-l1-01', { code: 'L1-EF',  name: 'Equipment Failure & Breakdown',      nameAr: 'أعطال المعدات والانهيار',          category: DowntimeCategory.MECHANICAL,          level: 1, isPlanned: false, sortOrder: 1 });
  await dc('dt-l1-02', { code: 'L1-HE',  name: 'Human Error & Operational Mistakes', nameAr: 'خطأ بشري وأخطاء تشغيلية',           category: DowntimeCategory.OPERATOR,            level: 1, isPlanned: false, sortOrder: 2 });
  await dc('dt-l1-03', { code: 'L1-MP',  name: 'Poor Maintenance Practices',         nameAr: 'ممارسات صيانة غير كافية',           category: DowntimeCategory.PROCESS,             level: 1, isPlanned: false, sortOrder: 3 });
  await dc('dt-l1-04', { code: 'L1-MS',  name: 'Material & Supply Chain Shortages',  nameAr: 'نقص المواد وسلسلة التوريد',         category: DowntimeCategory.MATERIAL,            level: 1, isPlanned: false, sortOrder: 4 });
  await dc('dt-l1-05', { code: 'L1-UN',  name: 'Utility & Network Outages',          nameAr: 'انقطاع المرافق والشبكات',           category: DowntimeCategory.UTILITY,             level: 1, isPlanned: false, sortOrder: 5 });
  await dc('dt-l1-06', { code: 'L1-PLN', name: 'Planned Stops',                      nameAr: 'التوقفات المخططة',                  category: DowntimeCategory.PLANNED_MAINTENANCE, level: 1, isPlanned: true,  sortOrder: 6 });

  // ── Level 2 ─────────────────────────────────────────────────
  await dc('dt-l2-01', { code: 'L2-MECH',   name: 'Mechanical Faults',           nameAr: 'أعطال ميكانيكية',           category: DowntimeCategory.MECHANICAL,          level: 2, parentId: 'dt-l1-01', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-02', { code: 'L2-ELEC',   name: 'Electrical Faults',           nameAr: 'أعطال كهربائية',            category: DowntimeCategory.ELECTRICAL,          level: 2, parentId: 'dt-l1-01', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-03', { code: 'L2-SETUP',  name: 'Setup & Changeovers',         nameAr: 'الإعداد والتحويل',          category: DowntimeCategory.CHANGEOVER,          level: 2, parentId: 'dt-l1-02', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-04', { code: 'L2-OPS',    name: 'Operator Unavailability',     nameAr: 'غياب المشغل',               category: DowntimeCategory.OPERATOR,            level: 2, parentId: 'dt-l1-02', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-05', { code: 'L2-PREV',   name: 'Lack of Preventive Care',     nameAr: 'غياب الصيانة الوقائية',     category: DowntimeCategory.PROCESS,             level: 2, parentId: 'dt-l1-03', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-06', { code: 'L2-TOOL',   name: 'Tooling Issues',              nameAr: 'مشاكل الأدوات',             category: DowntimeCategory.MECHANICAL,          level: 2, parentId: 'dt-l1-03', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-07', { code: 'L2-LOG',    name: 'Logistics / Warehouse',       nameAr: 'الخدمات اللوجستية والمستودع', category: DowntimeCategory.MATERIAL,           level: 2, parentId: 'dt-l1-04', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-08', { code: 'L2-QA',     name: 'Quality Inspection Hold',     nameAr: 'تعليق فحص الجودة',          category: DowntimeCategory.QUALITY,             level: 2, parentId: 'dt-l1-04', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-09', { code: 'L2-PWR',    name: 'Power & Pneumatics',          nameAr: 'الطاقة والهواء المضغوط',    category: DowntimeCategory.UTILITY,             level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 1 });
  await dc('dt-l2-10', { code: 'L2-IT',     name: 'IT & Connectivity',           nameAr: 'تقنية المعلومات والاتصالات', category: DowntimeCategory.UTILITY,            level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 2 });
  await dc('dt-l2-11', { code: 'L2-HVAC',   name: 'Environmental & HVAC',        nameAr: 'البيئة وتكييف الهواء',      category: DowntimeCategory.UTILITY,             level: 2, parentId: 'dt-l1-05', isPlanned: false, sortOrder: 3 });
  await dc('dt-l2-12', { code: 'L2-BRK',    name: 'Scheduled Breaks & Cleaning', nameAr: 'فترات الراحة والتنظيف',     category: DowntimeCategory.PLANNED_BREAK,       level: 2, parentId: 'dt-l1-06', isPlanned: true,  sortOrder: 1 });
  await dc('dt-l2-13', { code: 'L2-PMAINT', name: 'Planned Maintenance & Changeover', nameAr: 'الصيانة والتحويل المخطط', category: DowntimeCategory.PLANNED_MAINTENANCE, level: 2, parentId: 'dt-l1-06', isPlanned: true, sortOrder: 2 });

  // ── Level 3: Mechanical Faults (L2-01) ──────────────────────
  // Generic standard codes
  await dc('dt-l3-mech-001', { code: 'MECH-GEN-01', name: 'Jammed Conveyor',             nameAr: 'ناقل محشور',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', isPlanned: false, sortOrder:  1 });
  await dc('dt-l3-mech-002', { code: 'MECH-GEN-02', name: 'Motor Overheating',            nameAr: 'ارتفاع حرارة المحرك',      category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', isPlanned: false, sortOrder:  2 });
  // NCC — Big Betti
  await dc('dc-bb-BB-01', { code: 'BB-01', name: 'Piston for powder inlet gate',                  nameAr: 'مكبس بوابة دخول المسحوق',   category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  3 });
  await dc('dc-bb-BB-02', { code: 'BB-02', name: 'Screw piston for opening the powder inlet gate', nameAr: 'مسمار مكبس بوابة المسحوق',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  4 });
  await dc('dc-bb-BB-03', { code: 'BB-03', name: 'Glue tank piston + internal board',             nameAr: 'مكبس خزان الغراء + اللوحة', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  5 });
  await dc('dc-bb-BB-04', { code: 'BB-04', name: 'Glue system complete nozzle',                   nameAr: 'فوهة نظام الغراء الكاملة',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  6 });
  await dc('dc-bb-BB-06', { code: 'BB-06', name: 'Inner holder',                                  nameAr: 'حامل داخلي',                category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  7 });
  await dc('dc-bb-BB-08', { code: 'BB-08', name: 'Inner section cup',                             nameAr: 'كوب القسم الداخلي',         category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  8 });
  await dc('dc-bb-BB-12', { code: 'BB-12', name: 'Rollers drive the inner',                       nameAr: 'بكرات تحريك الجزء الداخلي', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder:  9 });
  await dc('dc-bb-BB-15', { code: 'BB-15', name: 'Chain failure',                                 nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder: 10 });
  await dc('dc-bb-BB-17', { code: 'BB-17', name: 'Printer machine fault',                         nameAr: 'عطل آلة الطباعة',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: bigBetti.id,     isPlanned: false, sortOrder: 11 });
  // NCC — Cartomac
  await dc('dc-cm-CM-01', { code: 'CM-01', name: 'Cartomac machine - lower large piston',          nameAr: 'مكبس سفلي كبير - كارتوماك', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 12 });
  await dc('dc-cm-CM-02', { code: 'CM-02', name: 'Carton section cup',                             nameAr: 'كوب قسم الكرتون',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 13 });
  await dc('dc-cm-CM-03', { code: 'CM-03', name: 'Carton closing piston right & left',             nameAr: 'مكبس إغلاق الكرتون Y/Y',    category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 14 });
  await dc('dc-cm-CM-04', { code: 'CM-04', name: 'Fixing piston and fixing track',                 nameAr: 'مكبس التثبيت ومسار التثبيت', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,    isPlanned: false, sortOrder: 15 });
  await dc('dc-cm-CM-05', { code: 'CM-05', name: 'Glue tank piston + internal board',              nameAr: 'مكبس خزان الغراء + اللوحة', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 16 });
  await dc('dc-cm-CM-06', { code: 'CM-06', name: 'Glue system complete nozzle',                    nameAr: 'فوهة نظام الغراء الكاملة',  category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 17 });
  await dc('dc-cm-CM-09', { code: 'CM-09', name: 'Chain failure',                                  nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 18 });
  await dc('dc-cm-CM-14', { code: 'CM-14', name: 'Printer machine fault',                          nameAr: 'عطل آلة الطباعة',           category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: cartomac.id,     isPlanned: false, sortOrder: 19 });
  // NCC — Euro-Pack
  await dc('dc-ep-EP-01', { code: 'EP-01', name: 'Piston and arm for cutting the stretch roll',    nameAr: 'مكبس وذراع قطع الشريط',     category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 20 });
  await dc('dc-ep-EP-04', { code: 'EP-04', name: 'Chain failure',                                  nameAr: 'عطل السلسلة',               category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-01', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 21 });

  // ── Level 3: Tooling Issues (L2-06) ──────────────────────────
  await dc('dt-l3-tool-001', { code: 'TOOL-01', name: 'Worn Part Past Service Life', nameAr: 'قطعة تجاوزت عمرها الافتراضي', category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-tool-002', { code: 'TOOL-02', name: 'Blunt Cutting Blades',        nameAr: 'شفرات قطع باهتة',              category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-tool-003', { code: 'TOOL-03', name: 'Broken Die / Mold',           nameAr: 'قالب مكسور',                   category: DowntimeCategory.MECHANICAL, level: 3, parentId: 'dt-l2-06', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Electrical Faults (L2-02) ───────────────────────
  await dc('dt-l3-elec-001', { code: 'ELEC-GEN-01', name: 'Blown Fuse',        nameAr: 'فيوز محترق',         category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-elec-002', { code: 'ELEC-GEN-02', name: 'PLC / Control Error', nameAr: 'خطأ في وحدة التحكم', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', isPlanned: false, sortOrder: 2 });
  // NCC — Big Betti
  await dc('dc-bb-BB-05', { code: 'BB-05', name: 'Inverter fault',                             nameAr: 'عطل الإنفرتر',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti.id,     isPlanned: false, sortOrder: 3 });
  await dc('dc-bb-BB-10', { code: 'BB-10', name: 'Electrical problems',                        nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti.id,     isPlanned: false, sortOrder: 4 });
  await dc('dc-bb-BB-11', { code: 'BB-11', name: 'Electrical trip for checkweigher belt',      nameAr: 'رحلة كهربائية لحزام الموازين', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti.id,   isPlanned: false, sortOrder: 5 });
  await dc('dc-bb-BB-13', { code: 'BB-13', name: 'Door sensors',                               nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: bigBetti.id,     isPlanned: false, sortOrder: 6 });
  // NCC — Cartomac
  await dc('dc-cm-CM-08', { code: 'CM-08', name: 'Door sensors',                               nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: cartomac.id,     isPlanned: false, sortOrder: 7 });
  await dc('dc-cm-CM-13', { code: 'CM-13', name: 'Electrical problems',                        nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: cartomac.id,     isPlanned: false, sortOrder: 8 });
  // NCC — Euro-Pack
  await dc('dc-ep-EP-02', { code: 'EP-02', name: 'Electrical trip for pallet wrapping rotating', nameAr: 'رحلة كهربائية لتغليف البالة', category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 9 });
  await dc('dc-ep-EP-05', { code: 'EP-05', name: 'Door sensors',                               nameAr: 'حساسات الباب',               category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 10 });
  await dc('dc-ep-EP-07', { code: 'EP-07', name: 'Electrical problems',                        nameAr: 'مشاكل كهربائية',             category: DowntimeCategory.ELECTRICAL, level: 3, parentId: 'dt-l2-02', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 11 });

  // ── Level 3: Setup & Changeovers (L2-03) ─────────────────────
  await dc('dt-l3-setup-001', { code: 'SETUP-01', name: 'Tooling Swap Delay',       nameAr: 'تأخر تبديل الأدوات',       category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-setup-002', { code: 'SETUP-02', name: 'Calibration Adjustment',   nameAr: 'ضبط المعايرة',             category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-setup-003', { code: 'SETUP-03', name: 'Cleaning / Sanitation',    nameAr: 'التنظيف / التعقيم',        category: DowntimeCategory.CHANGEOVER, level: 3, parentId: 'dt-l2-03', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Operator Unavailability (L2-04) ──────────────────
  await dc('dt-l3-ops-001', { code: 'OPS-01', name: 'Late Shift Handover',           nameAr: 'تأخر تسليم الوردية',       category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-ops-002', { code: 'OPS-02', name: 'Missing Operator / Ghost Shift', nameAr: 'غياب مشغل / وردية وهمية', category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 2 });
  await dc('dt-l3-ops-003', { code: 'OPS-03', name: 'Incorrect Machine Settings',    nameAr: 'إعدادات آلة خاطئة',       category: DowntimeCategory.OPERATOR, level: 3, parentId: 'dt-l2-04', isPlanned: false, sortOrder: 3 });

  // ── Level 3: Lack of Preventive Care (L2-05) ─────────────────
  await dc('dt-l3-prev-001', { code: 'PREV-01', name: 'Skipped Scheduled Inspection', nameAr: 'تجاهل الفحص الدوري',         category: DowntimeCategory.PROCESS, level: 3, parentId: 'dt-l2-05', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-prev-002', { code: 'PREV-02', name: 'Lack of Lubrication',          nameAr: 'نقص التزييت',               category: DowntimeCategory.PROCESS, level: 3, parentId: 'dt-l2-05', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Logistics / Warehouse (L2-07) ───────────────────
  await dc('dt-l3-log-001', { code: 'LOG-GEN-01', name: 'Wrong Material Delivered',  nameAr: 'تسليم مواد خاطئة',          category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', isPlanned: false, sortOrder: 1 });
  // NCC
  await dc('dc-bb-BB-16', { code: 'BB-16', name: 'Powder shortage',                  nameAr: 'نقص المسحوق',               category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: bigBetti.id, isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-18', { code: 'BB-18', name: 'Packing material shortage',        nameAr: 'نقص مواد التعبئة',          category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: bigBetti.id, isPlanned: false, sortOrder: 3 });
  await dc('dc-cm-CM-10', { code: 'CM-10', name: 'Packing material shortage',        nameAr: 'نقص مواد التعبئة',          category: DowntimeCategory.MATERIAL, level: 3, parentId: 'dt-l2-07', machineId: cartomac.id, isPlanned: false, sortOrder: 4 });

  // ── Level 3: Quality Inspection Hold (L2-08) ─────────────────
  await dc('dt-l3-qa-001', { code: 'QA-01', name: 'Waiting for QA Release',          nameAr: 'انتظار إفراج الجودة',       category: DowntimeCategory.QUALITY, level: 3, parentId: 'dt-l2-08', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-qa-002', { code: 'QA-02', name: 'Defective Raw Material Rejection', nameAr: 'رفض مواد خام معيبة',        category: DowntimeCategory.QUALITY, level: 3, parentId: 'dt-l2-08', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Power & Pneumatics (L2-09) ──────────────────────
  await dc('dt-l3-pwr-001', { code: 'PWR-GEN-01', name: 'Localized Voltage Spike',   nameAr: 'ارتفاع جهد موضعي',          category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-09', isPlanned: false, sortOrder: 1 });
  // NCC — air & power (shared across machines, machineId null = all)
  await dc('dc-bb-BB-07', { code: 'BB-07', name: 'Air pressure low',                 nameAr: 'ضغط الهواء منخفض',          category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: bigBetti.id,     isPlanned: false, sortOrder: 2 });
  await dc('dc-bb-BB-14', { code: 'BB-14', name: 'Main power failure',               nameAr: 'انقطاع الطاقة الرئيسي',     category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: bigBetti.id,     isPlanned: false, sortOrder: 3 });
  await dc('dc-cm-CM-11', { code: 'CM-11', name: 'Main power failure',               nameAr: 'انقطاع الطاقة الرئيسي',     category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: cartomac.id,     isPlanned: false, sortOrder: 4 });
  await dc('dc-cm-CM-12', { code: 'CM-12', name: 'Air pressure low',                 nameAr: 'ضغط الهواء منخفض',          category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: cartomac.id,     isPlanned: false, sortOrder: 5 });
  await dc('dc-ep-EP-06', { code: 'EP-06', name: 'Air pressure low',                 nameAr: 'ضغط الهواء منخفض',          category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 6 });
  await dc('dc-ep-EP-08', { code: 'EP-08', name: 'Main power failure',               nameAr: 'انقطاع الطاقة الرئيسي',     category: DowntimeCategory.UTILITY,  level: 3, parentId: 'dt-l2-09', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 7 });

  // ── Level 3: IT & Connectivity (L2-10) ───────────────────────
  await dc('dt-l3-it-001', { code: 'IT-01', name: 'Network Disruption / Internet Down', nameAr: 'انقطاع الشبكة / الإنترنت', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-10', isPlanned: false, sortOrder: 1 });
  await dc('dt-l3-it-002', { code: 'IT-02', name: 'Software Freeze / Server Crash',     nameAr: 'تجمد البرنامج / انهيار الخادم', category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-10', isPlanned: false, sortOrder: 2 });

  // ── Level 3: Environmental & HVAC (L2-11) ────────────────────
  await dc('dt-l3-hvac-001', { code: 'HVAC-GEN-01', name: 'Temperature Out of Range', nameAr: 'درجة حرارة خارج النطاق',    category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', isPlanned: false, sortOrder: 1 });
  await dc('dc-bb-BB-09', { code: 'BB-09', name: 'A/C failure',                       nameAr: 'عطل التكييف',               category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: bigBetti.id,     isPlanned: false, sortOrder: 2 });
  await dc('dc-cm-CM-07', { code: 'CM-07', name: 'A/C failure',                       nameAr: 'عطل التكييف',               category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: cartomac.id,     isPlanned: false, sortOrder: 3 });
  await dc('dc-ep-EP-03', { code: 'EP-03', name: 'A/C failure',                       nameAr: 'عطل التكييف',               category: DowntimeCategory.UTILITY, level: 3, parentId: 'dt-l2-11', machineId: euroPackRobot.id, isPlanned: false, sortOrder: 4 });

  // ── Level 3: Scheduled Breaks & Cleaning (L2-12) ─────────────
  await dc('dc-pln-PLN-01', { code: 'PLN-01', name: 'Planned break',     nameAr: 'استراحة مجدولة',    category: DowntimeCategory.PLANNED_BREAK,       level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 1 });
  await dc('dc-pln-PLN-02', { code: 'PLN-02', name: 'Planned cleaning',  nameAr: 'تنظيف مجدول',       category: DowntimeCategory.PLANNED_CLEANING,    level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 2 });
  await dc('dc-pln-PLN-05', { code: 'PLN-05', name: 'Scheduled shutdown', nameAr: 'إيقاف تشغيل مجدول', category: DowntimeCategory.PLANNED_MAINTENANCE, level: 3, parentId: 'dt-l2-12', isPlanned: true, sortOrder: 3 });

  // ── Level 3: Planned Maintenance & Changeover (L2-13) ────────
  await dc('dc-pln-PLN-04', { code: 'PLN-04', name: 'Preventive maintenance', nameAr: 'صيانة وقائية',     category: DowntimeCategory.PLANNED_MAINTENANCE, level: 3, parentId: 'dt-l2-13', isPlanned: true, sortOrder: 1 });
  await dc('dc-pln-PLN-03', { code: 'PLN-03', name: 'Product changeover',     nameAr: 'تحويل المنتج',     category: DowntimeCategory.CHANGEOVER,          level: 3, parentId: 'dt-l2-13', isPlanned: true, sortOrder: 2 });

  console.log(`✅ Downtime causes tree: 6 L1 categories, 13 L2 sub-categories, ~50 L3 specific reasons (NCC + standard)`);

  // ============================================================
  // SIDCO — USERS (from NCC Prerequisites File)
  // ============================================================
  const issaMasadeh = await prisma.user.upsert({
    where: { email: 'issa.masadeh@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'issa.masadeh@sidco.com.sa',
      name: 'Issa Masadeh',
      passwordHash,
      role: UserRole.FACTORY_ADMIN,
      phone: '0539429752',
      jobTitle: 'Factory Administrator',
      department: 'Operations',
      notifyEmail: true,
    },
  });

  const mohammedBrakat = await prisma.user.upsert({
    where: { email: 'mohammed.brakat@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'mohammed.brakat@sidco.com.sa',
      name: 'Mohammed Brakat',
      passwordHash,
      role: UserRole.PLANT_MANAGER,
      jobTitle: 'Plant Manager',
      department: 'Operations',
      notifyEmail: true,
    },
  });

  const mohammedYousef = await prisma.user.upsert({
    where: { email: 'mohammed.yousef@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'mohammed.yousef@sidco.com.sa',
      name: 'Mohammed Yousef',
      passwordHash,
      role: UserRole.PRODUCTION_SUPERVISOR,
      jobTitle: 'Production Supervisor',
      department: 'Production',
      notifyEmail: true,
    },
  });

  // Generic operator for SIDCO
  await prisma.user.upsert({
    where: { email: 'operator@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'operator@sidco.com.sa',
      name: 'Production Operator',
      passwordHash,
      role: UserRole.OPERATOR,
      jobTitle: 'Machine Operator',
      department: 'Production',
    },
  });

  // Maintenance user for SIDCO
  await prisma.user.upsert({
    where: { email: 'maintenance@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'maintenance@sidco.com.sa',
      name: 'Maintenance Technician',
      passwordHash,
      role: UserRole.MAINTENANCE_TECHNICIAN,
      jobTitle: 'Maintenance Technician',
      department: 'Maintenance',
    },
  });

  // Quality user for SIDCO
  await prisma.user.upsert({
    where: { email: 'quality@sidco.com.sa' },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      factoryId: sidco.id,
      email: 'quality@sidco.com.sa',
      name: 'Quality Engineer',
      passwordHash,
      role: UserRole.QUALITY_ENGINEER,
      jobTitle: 'Quality Engineer',
      department: 'Quality',
    },
  });

  console.log(`✅ SIDCO users: Issa Masadeh (Admin), Mohammed Brakat (Manager), Mohammed Yousef (Supervisor) + Operator + Maintenance + Quality`);

  // ============================================================
  // SIDCO — PLM ENGINEERING CHANGE REQUESTS (real workflow data)
  // ============================================================
  const crData: Array<{
    crNumber: string; title: string; description: string;
    type: 'BOM_CHANGE' | 'RECIPE_CHANGE' | 'PROCESS_CHANGE' | 'DESIGN_CHANGE';
    status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    itemNumber: string; reason: string; daysAhead: number; reviewed: boolean;
  }> = [
    {
      crNumber: 'ECR-2026-001',
      title: 'Update carton glue spec for GENTO 2.25 Kg cartons',
      description: 'Current hot-melt glue fails seal test in high humidity. Switch to supplier grade HM-240 on the Cartomac glue system.',
      type: 'BOM_CHANGE', status: 'IMPLEMENTED', priority: 'HIGH',
      itemNumber: '10310189', reason: 'Carton seal failures during summer humidity', daysAhead: -20, reviewed: true,
    },
    {
      crNumber: 'ECR-2026-002',
      title: 'Reduce Big Betti fill cycle for 1.5 Kg SKUs',
      description: 'Trial showed stable weights at 28s vs current 30s per inner for 1.5 Kg fills. Update routing cycle time after MSA.',
      type: 'PROCESS_CHANGE', status: 'APPROVED', priority: 'MEDIUM',
      itemNumber: '10310110', reason: 'Throughput improvement ~6% on 1.5 Kg runs', daysAhead: 14, reviewed: true,
    },
    {
      crNumber: 'ECR-2026-003',
      title: 'Alwatani Blue HF — perfume dosage adjustment',
      description: 'Marketing requested stronger scent retention. Increase perfume dosage from 0.30% to 0.35% in the blending recipe.',
      type: 'RECIPE_CHANGE', status: 'UNDER_REVIEW', priority: 'MEDIUM',
      itemNumber: '10310067', reason: 'Customer feedback on scent fade', daysAhead: 21, reviewed: true,
    },
    {
      crNumber: 'ECR-2026-004',
      title: 'New pallet pattern for REX 2.5 Kg cartons',
      description: 'Euro-Pack Robot pattern change from 8×5 to 7×6 to improve stability and reduce stretch film usage per pallet.',
      type: 'DESIGN_CHANGE', status: 'SUBMITTED', priority: 'LOW',
      itemNumber: '10310297', reason: 'Pallet lean reported by warehouse', daysAhead: 30, reviewed: false,
    },
    {
      crNumber: 'ECR-2026-005',
      title: 'SIDCO Extra White — replace inner bag film gauge',
      description: 'Move from 60μ to 55μ film for inner bags; requires Big Betti sealing temperature re-validation.',
      type: 'BOM_CHANGE', status: 'DRAFT', priority: 'MEDIUM',
      itemNumber: '10310111', reason: 'Packaging cost reduction initiative', daysAhead: 45, reviewed: false,
    },
  ];
  for (const c of crData) {
    await prisma.changeRequest.upsert({
      where: { factoryId_crNumber: { factoryId: sidco.id, crNumber: c.crNumber } },
      update: {},
      create: {
        factoryId: sidco.id,
        crNumber: c.crNumber,
        title: c.title,
        description: c.description,
        type: c.type,
        status: c.status,
        priority: c.priority,
        skuId: skuMap[c.itemNumber] ?? null,
        reason: c.reason,
        targetDate: new Date(Date.now() + c.daysAhead * 86_400_000),
        requestedById: mohammedYousef.id,
        reviewedById: c.reviewed ? mohammedBrakat.id : null,
        implementedAt: c.status === 'IMPLEMENTED' ? new Date(Date.now() - 5 * 86_400_000) : null,
      },
    });
  }
  console.log(`✅ SIDCO change requests: ${crData.length} ECRs across the workflow`);

  // ============================================================
  // SIDCO — SPARE PARTS (common parts from NCC downtime list)
  // ============================================================
  const spareParts = [
    { partNumber: 'SP-BB-001', name: 'Piston for powder inlet gate (Big Betti)', category: 'Pneumatic', machineCode: 'M1' },
    { partNumber: 'SP-BB-002', name: 'Glue tank piston + internal board', category: 'Pneumatic', machineCode: 'M1' },
    { partNumber: 'SP-BB-003', name: 'Glue system nozzle', category: 'Fluid System', machineCode: 'M1' },
    { partNumber: 'SP-BB-004', name: 'Inverter (Big Betti)', category: 'Electrical', machineCode: 'M1' },
    { partNumber: 'SP-BB-005', name: 'Inner section cup', category: 'Mechanical', machineCode: 'M1' },
    { partNumber: 'SP-CM-001', name: 'Cartomac lower large piston', category: 'Pneumatic', machineCode: 'M2' },
    { partNumber: 'SP-CM-002', name: 'Carton section cup', category: 'Mechanical', machineCode: 'M2' },
    { partNumber: 'SP-CM-003', name: 'Carton closing piston (right)', category: 'Pneumatic', machineCode: 'M2' },
    { partNumber: 'SP-CM-004', name: 'Carton closing piston (left)', category: 'Pneumatic', machineCode: 'M2' },
    { partNumber: 'SP-CM-005', name: 'Fixing piston', category: 'Pneumatic', machineCode: 'M2' },
    { partNumber: 'SP-EP-001', name: 'Stretch roll cutting arm piston', category: 'Pneumatic', machineCode: 'M4' },
    { partNumber: 'SP-COMMON-001', name: 'Door sensor switch', category: 'Electrical', machineCode: null },
    { partNumber: 'SP-COMMON-002', name: 'Drive chain (standard)', category: 'Mechanical', machineCode: null },
    { partNumber: 'SP-COMMON-003', name: 'Air filter element', category: 'Pneumatic', machineCode: null },
  ];

  for (const sp of spareParts) {
    await prisma.sparePart.upsert({
      where: { factoryId_partNumber: { factoryId: sidco.id, partNumber: sp.partNumber } },
      update: {},
      create: {
        factoryId: sidco.id,
        partNumber: sp.partNumber,
        name: sp.name,
        category: sp.category,
        stockQty: 2,
        minStockQty: 1,
        storageLocation: 'SIDCO-STORE-A',
      },
    });
  }
  console.log(`✅ SIDCO spare parts: ${spareParts.length} items`);

  // ============================================================
  // SIDCO — ENERGY METERS
  // ============================================================
  await prisma.energyMeter.upsert({
    where: { factoryId_meterNumber: { factoryId: sidco.id, meterNumber: 'EM-MAIN-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      meterNumber: 'EM-MAIN-01',
      name: 'Main Electrical Meter',
      type: EnergyType.ELECTRICAL,
      unit: 'kWh',
      location: 'LV Switchgear Room',
    },
  });

  await prisma.energyMeter.upsert({
    where: { factoryId_meterNumber: { factoryId: sidco.id, meterNumber: 'EM-COMP-01' } },
    update: {},
    create: {
      factoryId: sidco.id,
      meterNumber: 'EM-COMP-01',
      name: 'Compressed Air Meter',
      type: EnergyType.COMPRESSED_AIR,
      unit: 'm3',
      location: 'Utility Area',
    },
  });
  console.log(`✅ SIDCO energy meters loaded`);

  // ============================================================
  // SIDCO — NOTIFICATION RULES
  // ============================================================
  await prisma.notificationRule.upsert({
    where: { id: 'nr-sidco-downtime' },
    update: {},
    create: {
      id: 'nr-sidco-downtime',
      factoryId: sidco.id,
      name: 'Machine Downtime Alert',
      module: 'production',
      event: 'DOWNTIME_START',
      condition: { durationThreshold: 60 },
      channels: { email: true, whatsapp: false, sms: false },
      recipients: { roles: ['FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_SUPERVISOR'] },
      isActive: true,
    },
  });

  await prisma.notificationRule.upsert({
    where: { id: 'nr-sidco-oee' },
    update: {},
    create: {
      id: 'nr-sidco-oee',
      factoryId: sidco.id,
      name: 'Low OEE Alert',
      module: 'production',
      event: 'OEE_BELOW_THRESHOLD',
      condition: { threshold: 65 },
      channels: { email: true, whatsapp: false, sms: false },
      recipients: { roles: ['FACTORY_ADMIN', 'PLANT_MANAGER'] },
      isActive: true,
    },
  });
  console.log(`✅ SIDCO notification rules loaded`);

  // ============================================================
  // SDPF — Basic Structure (other factories)
  // ============================================================
  for (const factory of [sdpf, saf, ndpf, rntic]) {
    // Create packing area
    await prisma.area.upsert({
      where: { factoryId_code: { factoryId: factory.id, code: 'PACKING' } },
      update: {},
      create: { factoryId: factory.id, code: 'PACKING', name: 'Packing Area', type: AreaType.PACKING },
    });
    await prisma.area.upsert({
      where: { factoryId_code: { factoryId: factory.id, code: 'UTILITY' } },
      update: {},
      create: { factoryId: factory.id, code: 'UTILITY', name: 'Utility Area', type: AreaType.UTILITY },
    });
  }

  // SDPF specific machines from Requirements Matrix
  const sdpfPackingArea = await prisma.area.findFirst({ where: { factoryId: sdpf.id, code: 'PACKING' } });
  if (sdpfPackingArea) {
    const sdpfMachines = [
      { code: 'SDPF-M1-BIGBETTI', name: 'Big Betti', type: MachineType.FILLING_MACHINE },
      { code: 'SDPF-M2-CARTOMAC', name: 'Cartomac', type: MachineType.CARTONING_MACHINE },
      { code: 'SDPF-M3-CHECKWEIGH', name: 'Checkweigher', type: MachineType.CHECKWEIGHER },
      { code: 'SDPF-M4-ROBOT', name: 'Palletizing Robot', type: MachineType.ROBOT },
      { code: 'SDPF-M5-PAKONA', name: 'PAKONA', type: MachineType.WRAPPING_MACHINE },
    ];
    for (const m of sdpfMachines) {
      await prisma.machine.upsert({
        where: { factoryId_code: { factoryId: sdpf.id, code: m.code } },
        update: {},
        create: { factoryId: sdpf.id, areaId: sdpfPackingArea.id, code: m.code, name: m.name, machineType: m.type, criticality: Criticality.HIGH },
      });
    }
  }

  // RNTIC blow molding machines
  const rnticPackingArea = await prisma.area.findFirst({ where: { factoryId: rntic.id, code: 'PACKING' } });
  if (rnticPackingArea) {
    const ebmMachines = ['EBM-17', 'EBM-14', 'EBM-13', 'EBM-12', 'EBM-11', 'EBM-7', 'SBM-20', 'SBM-10'];
    for (const m of ebmMachines) {
      await prisma.machine.upsert({
        where: { factoryId_code: { factoryId: rntic.id, code: `RNTIC-${m}` } },
        update: {},
        create: { factoryId: rntic.id, areaId: rnticPackingArea.id, code: `RNTIC-${m}`, name: m, machineType: MachineType.BLOW_MOLDING, criticality: Criticality.HIGH },
      });
    }
  }

  console.log(`✅ SDPF, SAF, NDPF, RNTIC basic structure seeded`);

  // ============================================================
  // SIDCO — STORAGE LOCATIONS
  // ============================================================
  const storeLocs = [
    { code: 'SL-RM-A',  name: 'Raw Material Store A', zone: 'RAW_MATERIAL' },
    { code: 'SL-RM-B',  name: 'Raw Material Store B', zone: 'RAW_MATERIAL' },
    { code: 'SL-FG-A',  name: 'Finished Goods Store A', zone: 'FINISHED_GOODS' },
    { code: 'SL-SP-A',  name: 'Spare Parts Store', zone: 'SPARE_PARTS' },
    { code: 'SL-QC-A',  name: 'Quarantine Area', zone: 'QUARANTINE' },
    { code: 'SL-PROD',  name: 'Production Floor', zone: 'PRODUCTION' },
  ];

  const slMap: Record<string, string> = {};
  for (const sl of storeLocs) {
    const loc = await (prisma as any).storageLocation.upsert({
      where: { factoryId_code: { factoryId: sidco.id, code: sl.code } },
      update: {},
      create: { factoryId: sidco.id, code: sl.code, name: sl.name, zone: sl.zone },
    });
    slMap[sl.code] = loc.id;
  }
  console.log(`✅ SIDCO storage locations: ${storeLocs.length} zones`);

  // ============================================================
  // SIDCO — WORKCENTER HIERARCHY (ISA-95 PLANT > AREA > LINE > CELL)
  // ============================================================
  const wcPlant = await (prisma as any).workCenter.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'WC-PLANT' } },
    update: {},
    create: { factoryId: sidco.id, code: 'WC-PLANT', name: 'SIDCO Production Plant', level: 'PLANT', description: 'Top-level plant scheduling unit' },
  });

  const wcMaking = await (prisma as any).workCenter.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'WC-MAKING' } },
    update: {},
    create: { factoryId: sidco.id, parentId: wcPlant.id, code: 'WC-MAKING', name: 'Making Area', level: 'AREA', description: 'Powder manufacturing area' },
  });

  const wcPacking = await (prisma as any).workCenter.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'WC-PACKING' } },
    update: {},
    create: { factoryId: sidco.id, parentId: wcPlant.id, code: 'WC-PACKING', name: 'Packing Area', level: 'AREA', description: 'Packing and finishing area' },
  });

  const wcLine1 = await (prisma as any).workCenter.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'WC-PL01' } },
    update: {},
    create: { factoryId: sidco.id, parentId: wcPacking.id, code: 'WC-PL01', name: 'Packing Line 1', level: 'LINE', capacity: 120 },
  });

  const wcMixingLine = await (prisma as any).workCenter.upsert({
    where: { factoryId_code: { factoryId: sidco.id, code: 'WC-MIX-L1' } },
    update: {},
    create: { factoryId: sidco.id, parentId: wcMaking.id, code: 'WC-MIX-L1', name: 'Mixing Line 1', level: 'LINE', capacity: 2000 },
  });

  const wcCells = [
    { code: 'WC-BETTI',   name: 'Big Betti Cell',         parentId: wcLine1.id },
    { code: 'WC-CARTOMAC',name: 'Cartomac Cell',           parentId: wcLine1.id },
    { code: 'WC-CHECKWT', name: 'Checkweigher Cell',       parentId: wcLine1.id },
    { code: 'WC-EUROPACK',name: 'Euro-Pack Robot Cell',     parentId: wcLine1.id },
    { code: 'WC-UNITECH', name: 'Uni-tech Wrapping Cell',  parentId: wcLine1.id },
    { code: 'WC-MIXER-01',name: 'Mixer 01',                parentId: wcMixingLine.id },
  ];

  for (const wc of wcCells) {
    await (prisma as any).workCenter.upsert({
      where: { factoryId_code: { factoryId: sidco.id, code: wc.code } },
      update: {},
      create: { factoryId: sidco.id, parentId: wc.parentId, code: wc.code, name: wc.name, level: 'CELL' },
    });
  }
  console.log(`✅ SIDCO WorkCenter hierarchy: PLANT > 2 AREAs > 2 LINEs > 6 CELLs`);

  // ============================================================
  // SIDCO — RAW MATERIALS (NCC detergent powder ingredients)
  // ============================================================
  const rawMaterials = [
    { code: 'RM-STPP',   name: 'Sodium Tripolyphosphate (STPP)',  unit: 'kg',  category: 'Chemical',   unitCost: 12.5,  minStock: 5000 },
    { code: 'RM-LAS',    name: 'Linear Alkylbenzene Sulfonate',   unit: 'kg',  category: 'Surfactant', unitCost: 18.0,  minStock: 3000 },
    { code: 'RM-SODA',   name: 'Soda Ash (Na2CO3)',               unit: 'kg',  category: 'Chemical',   unitCost: 4.2,   minStock: 10000 },
    { code: 'RM-ZEOLITE',name: 'Zeolite A',                       unit: 'kg',  category: 'Chemical',   unitCost: 8.0,   minStock: 5000 },
    { code: 'RM-CMC',    name: 'Carboxymethyl Cellulose (CMC)',   unit: 'kg',  category: 'Chemical',   unitCost: 22.0,  minStock: 1000 },
    { code: 'RM-PERF',   name: 'Perfume / Fragrance Blend',       unit: 'kg',  category: 'Additive',   unitCost: 85.0,  minStock: 500 },
    { code: 'RM-BRIGHT', name: 'Optical Brightener',              unit: 'kg',  category: 'Additive',   unitCost: 45.0,  minStock: 200 },
    { code: 'RM-SALT',   name: 'Salt (NaCl)',                     unit: 'kg',  category: 'Chemical',   unitCost: 1.8,   minStock: 5000 },
    { code: 'RM-ENZYME', name: 'Enzyme Blend',                    unit: 'kg',  category: 'Biological', unitCost: 120.0, minStock: 300 },
    { code: 'RM-COLOUR', name: 'Colour Pigment (Blue/Violet)',    unit: 'kg',  category: 'Additive',   unitCost: 35.0,  minStock: 100 },
    { code: 'RM-INNER',  name: 'Polyethylene Inner Bag (1.5kg)',  unit: 'pcs', category: 'Packaging',  unitCost: 0.18,  minStock: 50000 },
    { code: 'RM-CARTON', name: 'Corrugated Carton Box',           unit: 'pcs', category: 'Packaging',  unitCost: 0.95,  minStock: 10000 },
  ];

  const rmMap: Record<string, string> = {};
  for (const rm of rawMaterials) {
    const mat = await (prisma as any).rawMaterial.upsert({
      where: { factoryId_code: { factoryId: sidco.id, code: rm.code } },
      update: { unitCost: rm.unitCost },
      create: {
        factoryId: sidco.id,
        code: rm.code,
        name: rm.name,
        unit: rm.unit,
        category: rm.category,
        unitCost: rm.unitCost,
        minStock: rm.minStock,
        storageLocationId: rm.category === 'Packaging' ? slMap['SL-RM-B'] : slMap['SL-RM-A'],
      },
    });
    rmMap[rm.code] = mat.id;
  }
  console.log(`✅ SIDCO raw materials: ${rawMaterials.length} items`);

  // ============================================================
  // SIDCO — MATERIAL LOTS (3–4 lots per raw material)
  // ============================================================
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
  const daysAhead = (d: number) => new Date(now.getTime() + d * 86400000);

  const lotsToSeed = [
    // STPP
    { rmCode: 'RM-STPP',    lot: 'LOT-STPP-2024-01', qty: 8000,  remaining: 1200,  status: 'ACTIVE',    received: daysAgo(90), expiry: daysAhead(275), supplier: 'Prayon SA' },
    { rmCode: 'RM-STPP',    lot: 'LOT-STPP-2024-02', qty: 10000, remaining: 10000, status: 'ACTIVE',    received: daysAgo(15), expiry: daysAhead(350), supplier: 'Prayon SA' },
    { rmCode: 'RM-STPP',    lot: 'LOT-STPP-2023-04', qty: 5000,  remaining: 0,     status: 'COMPLETED', received: daysAgo(180), expiry: daysAhead(180), supplier: 'Prayon SA' },
    // LAS
    { rmCode: 'RM-LAS',     lot: 'LOT-LAS-2024-01',  qty: 6000,  remaining: 800,   status: 'ACTIVE',    received: daysAgo(60),  expiry: daysAhead(300), supplier: 'Sasol' },
    { rmCode: 'RM-LAS',     lot: 'LOT-LAS-2024-02',  qty: 6000,  remaining: 6000,  status: 'ACTIVE',    received: daysAgo(5),   expiry: daysAhead(360), supplier: 'Sasol' },
    // Soda Ash
    { rmCode: 'RM-SODA',    lot: 'LOT-SODA-2024-01', qty: 20000, remaining: 4500,  status: 'ACTIVE',    received: daysAgo(45),  expiry: daysAhead(540), supplier: 'Solvay' },
    { rmCode: 'RM-SODA',    lot: 'LOT-SODA-2024-02', qty: 25000, remaining: 25000, status: 'ACTIVE',    received: daysAgo(2),   expiry: daysAhead(540), supplier: 'Solvay' },
    // Zeolite
    { rmCode: 'RM-ZEOLITE', lot: 'LOT-ZEO-2024-01',  qty: 8000,  remaining: 2100,  status: 'ACTIVE',    received: daysAgo(70),  expiry: daysAhead(350), supplier: 'PQ Corp' },
    { rmCode: 'RM-ZEOLITE', lot: 'LOT-ZEO-2023-03',  qty: 4000,  remaining: 0,     status: 'COMPLETED', received: daysAgo(200), expiry: daysAgo(5),     supplier: 'PQ Corp' },
    // CMC
    { rmCode: 'RM-CMC',     lot: 'LOT-CMC-2024-01',  qty: 2000,  remaining: 600,   status: 'ACTIVE',    received: daysAgo(30),  expiry: daysAhead(700), supplier: 'Ashland' },
    // Perfume
    { rmCode: 'RM-PERF',    lot: 'LOT-PERF-2024-01', qty: 1000,  remaining: 250,   status: 'ACTIVE',    received: daysAgo(40),  expiry: daysAhead(180), supplier: 'Firmenich' },
    { rmCode: 'RM-PERF',    lot: 'LOT-PERF-2024-02', qty: 500,   remaining: 500,   status: 'ACTIVE',    received: daysAgo(3),   expiry: daysAhead(220), supplier: 'Firmenich' },
    { rmCode: 'RM-PERF',    lot: 'LOT-PERF-Q-001',   qty: 200,   remaining: 200,   status: 'QUARANTINE', received: daysAgo(10), expiry: daysAhead(200), supplier: 'Alternative Source' },
    // Brightener
    { rmCode: 'RM-BRIGHT',  lot: 'LOT-OB-2024-01',   qty: 400,   remaining: 120,   status: 'ACTIVE',    received: daysAgo(50),  expiry: daysAhead(400), supplier: 'Huntsman' },
    // Salt
    { rmCode: 'RM-SALT',    lot: 'LOT-NaCl-2024-01', qty: 10000, remaining: 3800,  status: 'ACTIVE',    received: daysAgo(35),  expiry: null,           supplier: 'Saudi Mining Co.' },
    { rmCode: 'RM-SALT',    lot: 'LOT-NaCl-2024-02', qty: 15000, remaining: 15000, status: 'ACTIVE',    received: daysAgo(1),   expiry: null,           supplier: 'Saudi Mining Co.' },
    // Enzyme
    { rmCode: 'RM-ENZYME',  lot: 'LOT-ENZ-2024-01',  qty: 500,   remaining: 80,    status: 'ACTIVE',    received: daysAgo(60),  expiry: daysAhead(60),  supplier: 'Novozymes' },
    { rmCode: 'RM-ENZYME',  lot: 'LOT-ENZ-2024-02',  qty: 300,   remaining: 300,   status: 'RELEASED',  received: daysAgo(7),   expiry: daysAhead(120), supplier: 'Novozymes' },
    // Colour
    { rmCode: 'RM-COLOUR',  lot: 'LOT-COL-2024-01',  qty: 200,   remaining: 55,    status: 'ACTIVE',    received: daysAgo(80),  expiry: daysAhead(280), supplier: 'Clariant' },
    // Packaging
    { rmCode: 'RM-INNER',   lot: 'LOT-PKG-INNER-01', qty: 100000,remaining: 42000, status: 'ACTIVE',    received: daysAgo(20),  expiry: null,           supplier: 'NCC Plastics' },
    { rmCode: 'RM-CARTON',  lot: 'LOT-PKG-CTN-01',   qty: 50000, remaining: 18000, status: 'ACTIVE',    received: daysAgo(15),  expiry: null,           supplier: 'Riyadh Carton' },
  ];

  for (const lot of lotsToSeed) {
    const rmId = rmMap[lot.rmCode];
    const rm = rawMaterials.find(r => r.code === lot.rmCode)!;
    if (!rmId) continue;
    await (prisma as any).materialLot.upsert({
      where: { factoryId_lotNumber_materialCode: { factoryId: sidco.id, lotNumber: lot.lot, materialCode: rm.code } },
      update: {},
      create: {
        factoryId: sidco.id,
        rawMaterialId: rmId,
        materialCode: rm.code,
        materialName: rm.name,
        lotNumber: lot.lot,
        supplierName: lot.supplier,
        quantity: lot.qty,
        remainingQty: lot.remaining,
        unit: rm.unit,
        status: lot.status,
        receivedAt: lot.received,
        expiryDate: lot.expiry ?? undefined,
        storageLocationId: lot.status === 'QUARANTINE' ? slMap['SL-QC-A'] : slMap['SL-RM-A'],
      } as any,
    });
  }
  console.log(`✅ SIDCO material lots: ${lotsToSeed.length} lots across ${rawMaterials.length} raw materials`);

  // ============================================================
  // SIDCO — RECIPE (Standard GENTO 2.25kg HF Formula)
  // ============================================================
  const gentoSkuId = skuMap['10310191']; // GENTO Original HF 2.25kg
  if (gentoSkuId && rmMap['RM-STPP']) {
    const recipe = await (prisma as any).recipe.upsert({
      where: { skuId_version: { skuId: gentoSkuId, version: '1.0' } },
      update: {},
      create: {
        factoryId: sidco.id,
        skuId: gentoSkuId,
        code: 'RCP-GENTO-225-HF',
        version: '1.0',
        name: 'GENTO 2.25kg HF — Standard Formula',
        description: 'Standard powder detergent formula for GENTO 2.25kg High Foam variants',
        status: 'APPROVED',
        batchSize: 2000,
        batchUnit: 'kg',
        yieldPct: 98.5,
        cycleTimeSecs: 3600,
        shelfLifeDays: 730,
        storageConditions: 'Store in dry conditions below 35°C, away from moisture',
        approvedAt: daysAgo(30),
        approvedById: platformUser.id,
        effectiveFrom: daysAgo(30),
        notes: 'Validated formula — approved for production per QC report QC-2024-045',
      } as any,
    });

    // Recipe ingredients (BOM)
    const bom = [
      { rmCode: 'RM-STPP',    phase: 'A', qty: 180,   unit: 'kg',  scrap: 0.5,  sort: 1  },
      { rmCode: 'RM-LAS',     phase: 'A', qty: 220,   unit: 'kg',  scrap: 0.5,  sort: 2  },
      { rmCode: 'RM-SODA',    phase: 'A', qty: 600,   unit: 'kg',  scrap: 0.3,  sort: 3  },
      { rmCode: 'RM-ZEOLITE', phase: 'A', qty: 450,   unit: 'kg',  scrap: 0.5,  sort: 4  },
      { rmCode: 'RM-CMC',     phase: 'B', qty: 20,    unit: 'kg',  scrap: 1.0,  sort: 5  },
      { rmCode: 'RM-SALT',    phase: 'A', qty: 300,   unit: 'kg',  scrap: 0.2,  sort: 6  },
      { rmCode: 'RM-ENZYME',  phase: 'C', qty: 15,    unit: 'kg',  scrap: 2.0,  sort: 7, optional: true },
      { rmCode: 'RM-BRIGHT',  phase: 'B', qty: 8,     unit: 'kg',  scrap: 2.0,  sort: 8  },
      { rmCode: 'RM-COLOUR',  phase: 'B', qty: 4,     unit: 'kg',  scrap: 3.0,  sort: 9  },
      { rmCode: 'RM-PERF',    phase: 'C', qty: 22,    unit: 'kg',  scrap: 1.0,  sort: 10 },
      { rmCode: 'RM-INNER',   phase: 'PKG', qty: 889, unit: 'pcs', scrap: 1.0,  sort: 11 }, // 2000kg / 2.25kg per unit = 889 packs
      { rmCode: 'RM-CARTON',  phase: 'PKG', qty: 223, unit: 'pcs', scrap: 0.5,  sort: 12 }, // 4 units per inner
    ];

    for (const ing of bom) {
      const rmId = rmMap[ing.rmCode];
      if (!rmId) continue;
      const existing = await (prisma as any).recipeIngredient.findFirst({
        where: { recipeId: recipe.id, rawMaterialId: rmId },
      });
      if (!existing) {
        await (prisma as any).recipeIngredient.create({
          data: {
            recipeId: recipe.id,
            rawMaterialId: rmId,
            phase: ing.phase,
            quantityPer: ing.qty,
            unit: ing.unit,
            scrapFactor: ing.scrap,
            isOptional: (ing as any).optional ?? false,
            sortOrder: ing.sort,
          },
        });
      }
    }

    // Clone as draft v2.0 for editing
    const recipeV2 = await (prisma as any).recipe.upsert({
      where: { skuId_version: { skuId: gentoSkuId, version: '2.0' } },
      update: {},
      create: {
        factoryId: sidco.id,
        skuId: gentoSkuId,
        code: 'RCP-GENTO-225-HF-v20',
        version: '2.0',
        name: 'GENTO 2.25kg HF — Formula v2 (Enzyme Enhanced)',
        description: 'Draft v2 with increased enzyme dosage and new fragrance blend',
        status: 'DRAFT',
        batchSize: 2000,
        batchUnit: 'kg',
        yieldPct: 98.0,
        cycleTimeSecs: 3600,
        shelfLifeDays: 730,
        storageConditions: 'Store in dry conditions below 35°C, away from moisture',
        notes: `Cloned from RCP-GENTO-225-HF v1.0 — increasing enzyme level from 15kg to 25kg per batch`,
      } as any,
    });

    // Copy BOM ingredients to v2
    for (const ing of bom) {
      const rmId = rmMap[ing.rmCode];
      if (!rmId) continue;
      const existing = await (prisma as any).recipeIngredient.findFirst({
        where: { recipeId: recipeV2.id, rawMaterialId: rmId },
      });
      if (!existing) {
        await (prisma as any).recipeIngredient.create({
          data: {
            recipeId: recipeV2.id,
            rawMaterialId: rmId,
            phase: ing.phase,
            quantityPer: ing.rmCode === 'RM-ENZYME' ? 25 : ing.qty, // Increased enzyme
            unit: ing.unit,
            scrapFactor: ing.scrap,
            isOptional: (ing as any).optional ?? false,
            sortOrder: ing.sort,
          },
        });
      }
    }

    console.log(`✅ SIDCO recipes: v1.0 (APPROVED) + v2.0 (DRAFT) for GENTO 2.25kg HF`);
  }

  // ============================================================
  // SIDCO — QUALITY PLANS (ISA-95 QualityTestSpecification)
  // 3 approved plans: INCOMING / IN_PROCESS / FINAL
  // ============================================================
  const qpIncoming = await (prisma as any).qualityPlan.upsert({
    where: { id: 'qp-sidco-incoming-001' },
    update: {},
    create: {
      id: 'qp-sidco-incoming-001',
      factoryId: sidco.id,
      code: 'QP-RM-SIDCO-001',
      name: 'Incoming Raw Material Inspection',
      type: 'INCOMING',
      samplingFrequency: 'EVERY_BATCH',
      samplingQty: 5,
      version: '1.0',
      isActive: true,
      approvedAt: daysAgo(30),
      approvedById: issaMasadeh.id,
    },
  });

  const qpInProcess = await (prisma as any).qualityPlan.upsert({
    where: { id: 'qp-sidco-inprocess-001' },
    update: {},
    create: {
      id: 'qp-sidco-inprocess-001',
      factoryId: sidco.id,
      skuId: skuMap['10310191'], // GENTO Original HF 2.25kg
      machineId: bigBetti.id,
      code: 'QP-IP-LINE1-001',
      name: 'In-Process Packing Quality Check',
      type: 'IN_PROCESS',
      samplingFrequency: 'HOURLY',
      samplingQty: 10,
      version: '1.0',
      isActive: true,
      approvedAt: daysAgo(25),
      approvedById: issaMasadeh.id,
    },
  });

  const qpFinal = await (prisma as any).qualityPlan.upsert({
    where: { id: 'qp-sidco-final-001' },
    update: {},
    create: {
      id: 'qp-sidco-final-001',
      factoryId: sidco.id,
      skuId: skuMap['10310191'], // GENTO Original HF 2.25kg
      code: 'QP-FN-GENTO-001',
      name: 'Final Inspection — GENTO Products',
      type: 'FINAL',
      samplingFrequency: 'EVERY_BATCH',
      samplingQty: 20,
      version: '1.0',
      isActive: true,
      approvedAt: daysAgo(20),
      approvedById: issaMasadeh.id,
    },
  });

  // Quality Parameters (ISA-95 QualityTestSpecificationProperty)
  const paramSeed = async (id: string, planId: string, data: Record<string, any>) => {
    const existing = await (prisma as any).qualityParameter.findUnique({ where: { id } });
    if (!existing) await (prisma as any).qualityParameter.create({ data: { id, planId, ...data } });
  };

  // INCOMING parameters (raw material checks)
  await paramSeed('qp-param-inc-01', qpIncoming.id, { name: 'Moisture Content', unit: '%',   nominalValue: 3.5, ucl: 5.0, lcl: 1.0, usl: 6.0, lsl: 0.5, checkMethod: 'Karl Fischer titration',  isKPI: true,  sortOrder: 1 });
  await paramSeed('qp-param-inc-02', qpIncoming.id, { name: 'Bulk Density',     unit: 'g/L', nominalValue: 650, ucl: 700, lcl: 600, usl: 720, lsl: 580, checkMethod: 'Bulk density apparatus',    isKPI: false, sortOrder: 2 });
  await paramSeed('qp-param-inc-03', qpIncoming.id, { name: 'pH (1% solution)', unit: 'pH',  nominalValue: 10.5,ucl: 11.0,lcl: 10.0,usl: 11.5,lsl: 9.5, checkMethod: 'Digital pH meter',          isKPI: true,  sortOrder: 3 });

  // IN_PROCESS parameters (packing line checks)
  await paramSeed('qp-param-ip-01', qpInProcess.id, { name: 'Fill Weight',    unit: 'g',    nominalValue: 2250, ucl: 2280, lcl: 2220, usl: 2300, lsl: 2200, checkMethod: 'Calibrated weighing scale', isKPI: true,  sortOrder: 1 });
  await paramSeed('qp-param-ip-02', qpInProcess.id, { name: 'Seal Strength',  unit: 'N',    nominalValue: 12.0, ucl: 14.0, lcl: 10.0, usl: 15.0, lsl: 8.0,  checkMethod: 'Seal strength tester',      isKPI: true,  sortOrder: 2 });
  await paramSeed('qp-param-ip-03', qpInProcess.id, { name: 'Cap Torque',     unit: 'N·cm', nominalValue: 8.0,  ucl: 10.0, lcl: 6.0,  usl: 12.0, lsl: 5.0,  checkMethod: 'Digital torque meter',       isKPI: false, sortOrder: 3 });
  await paramSeed('qp-param-ip-04', qpInProcess.id, { name: 'Label Position', unit: 'mm',   nominalValue: 0,    ucl: 2.0,  lcl: -2.0, usl: 3.0,  lsl: -3.0, checkMethod: 'Visual + ruler',              isKPI: false, sortOrder: 4 });

  // FINAL parameters (pre-shipment checks)
  await paramSeed('qp-param-fn-01', qpFinal.id, { name: 'Net Weight',        unit: 'g',          nominalValue: 2250, ucl: 2275, lcl: 2225, usl: 2290, lsl: 2210, checkMethod: 'Certified scale',             isKPI: true,  sortOrder: 1 });
  await paramSeed('qp-param-fn-02', qpFinal.id, { name: 'Appearance Score',  unit: 'score (1-5)', nominalValue: 5,    usl: 5,    lsl: 3,                         checkMethod: 'Visual per QC standard',       isKPI: false, sortOrder: 2 });
  await paramSeed('qp-param-fn-03', qpFinal.id, { name: 'Barcode Read Rate', unit: '%',          nominalValue: 100,  ucl: 100,  lcl: 99,   usl: 100,  lsl: 98,   checkMethod: 'Barcode scanner',              isKPI: true,  sortOrder: 3 });
  await paramSeed('qp-param-fn-04', qpFinal.id, { name: 'Carton Integrity',  unit: 'pass/fail',  nominalValue: 1,    usl: 1,    lsl: 1,                         checkMethod: 'Physical inspection',          isKPI: false, sortOrder: 4 });

  console.log(`✅ SIDCO quality plans: 3 approved plans (INCOMING × 3 params, IN_PROCESS × 4 params, FINAL × 4 params)`);

  // ============================================================
  // SIDCO — PRODUCTION ORDERS (ISA-95 Level 4 — ERP/Scheduling)
  // POs are released from the scheduling system and broken into WOs
  // ============================================================

  const po1 = await (prisma as any).productionOrder.upsert({
    where: { orderNumber: 'PO-NCC-1050' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'PO-NCC-1050',
      sapOrderNumber: 'SAP-4500011050',
      skuId: skuMap['10310191'],       // GENTO Original HF 2.25kg
      targetQty: 890,
      completedQty: 875,
      unit: 'CARTON',
      status: 'COMPLETED',
      priority: 'HIGH',
      plannedStart: daysAgo(8),
      plannedEnd: daysAgo(6),
      actualStart: daysAgo(7),
      actualEnd: new Date(daysAgo(7).getTime() + 8.5 * 3600000),
      customer: 'Panda Retail Company',
      notes: 'June monthly replenishment — Al-Othaim stores. Delivered on time.',
      createdById: issaMasadeh.id,
    },
  });

  const po2 = await (prisma as any).productionOrder.upsert({
    where: { orderNumber: 'PO-NCC-1051' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'PO-NCC-1051',
      sapOrderNumber: 'SAP-4500011051',
      skuId: skuMap['10310189'],       // GENTO Flower HF 2.25kg
      targetQty: 750,
      completedQty: 720,
      unit: 'CARTON',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      plannedStart: daysAgo(6),
      plannedEnd: daysAgo(4),
      actualStart: daysAgo(5),
      actualEnd: new Date(daysAgo(5).getTime() + 7.5 * 3600000),
      customer: 'Carrefour KSA',
      notes: 'NCR raised for fill weight on nozzle #3. Batch partially reworked.',
      createdById: issaMasadeh.id,
    },
  });

  const po3 = await (prisma as any).productionOrder.upsert({
    where: { orderNumber: 'PO-NCC-1052' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'PO-NCC-1052',
      sapOrderNumber: 'SAP-4500011052',
      skuId: skuMap['10310190'],       // GENTO Oud HF 2.25kg
      targetQty: 1200,
      completedQty: 640,
      unit: 'CARTON',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      plannedStart: daysAgo(1),
      plannedEnd: daysAhead(2),
      actualStart: daysAgo(1),
      customer: 'Extra Stores',
      notes: 'Running — 53% complete. On track for delivery.',
      createdById: issaMasadeh.id,
    },
  });

  const po4 = await (prisma as any).productionOrder.upsert({
    where: { orderNumber: 'PO-NCC-1053' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'PO-NCC-1053',
      sapOrderNumber: 'SAP-4500011053',
      skuId: skuMap['10310214'],       // Safe Original HF 2.25kg
      targetQty: 500,
      completedQty: 0,
      unit: 'CARTON',
      status: 'RELEASED',
      priority: 'MEDIUM',
      plannedStart: daysAhead(1),
      plannedEnd: daysAhead(3),
      customer: 'Danube Group',
      notes: 'Released to shop floor — machine allocation pending.',
      createdById: issaMasadeh.id,
    },
  });

  const po5 = await (prisma as any).productionOrder.upsert({
    where: { orderNumber: 'PO-NCC-1054' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'PO-NCC-1054',
      sapOrderNumber: 'SAP-4500011054',
      skuId: skuMap['10310067'],       // Alwatani Blue HF 2.0kg
      targetQty: 600,
      completedQty: 198,
      unit: 'CARTON',
      status: 'ON_HOLD',
      priority: 'MEDIUM',
      plannedStart: daysAgo(2),
      plannedEnd: daysAhead(2),
      actualStart: daysAgo(2),
      customer: 'Tamimi Markets',
      notes: 'On hold — packaging film delayed from supplier (ETA +3 days).',
      createdById: issaMasadeh.id,
    },
  });

  console.log(`✅ SIDCO production orders: 5 POs (COMPLETED×2, IN_PROGRESS×1, RELEASED×1, ON_HOLD×1)`);

  // ============================================================
  // SIDCO — WORK ORDERS (realistic production schedule)
  // Linked to GENTO, Safe, Alwatani SKUs on Big Betti / PL-01
  // ============================================================
  const wo1 = await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0001' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0001',
      productionOrderId: po1.id,
      skuId: skuMap['10310191'],    // GENTO Original HF 2.25kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'COMPLETED',
      priority: 'HIGH',
      plannedQty: 890,
      actualQty: 885,
      goodQty: 875,
      scrapQty: 10,
      oee: 86.5,
      availability: 92.0,
      performance: 94.0,
      quality: 98.9,
      plannedStart: daysAgo(7),
      plannedEnd: new Date(daysAgo(7).getTime() + 8 * 3600000),
      actualStart: daysAgo(7),
      actualEnd: new Date(daysAgo(7).getTime() + 8.5 * 3600000),
      operatorId: mohammedYousef.id,
      createdById: issaMasadeh.id,
    },
  });

  const wo2 = await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0002' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0002',
      productionOrderId: po2.id,
      skuId: skuMap['10310189'],    // GENTO Flower HF 2.25kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'COMPLETED',
      priority: 'MEDIUM',
      plannedQty: 750,
      actualQty: 748,
      goodQty: 720,
      scrapQty: 28,
      oee: 78.2,
      availability: 88.0,
      performance: 91.0,
      quality: 96.3,
      plannedStart: daysAgo(5),
      plannedEnd: new Date(daysAgo(5).getTime() + 7 * 3600000),
      actualStart: daysAgo(5),
      actualEnd: new Date(daysAgo(5).getTime() + 7.5 * 3600000),
      operatorId: mohammedYousef.id,
      createdById: issaMasadeh.id,
      notes: 'Higher than expected scrap — fill weight issues detected mid-run. Batch held for QA review.',
    },
  });

  const wo3 = await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0003' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0003',
      productionOrderId: po3.id,
      skuId: skuMap['10310190'],    // GENTO Oud HF 2.25kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      plannedQty: 1200,
      actualQty: 640,
      goodQty: 632,
      scrapQty: 8,
      oee: 82.1,
      availability: 90.0,
      performance: 91.5,
      quality: 98.8,
      plannedStart: daysAgo(1),
      plannedEnd: daysAhead(1),
      actualStart: daysAgo(1),
      operatorId: mohammedYousef.id,
      createdById: issaMasadeh.id,
    },
  });

  await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0004' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0004',
      productionOrderId: po4.id,
      skuId: skuMap['10310214'],    // Safe Original HF 2.25kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'PLANNED',
      priority: 'MEDIUM',
      plannedQty: 500,
      actualQty: 0,
      goodQty: 0,
      scrapQty: 0,
      plannedStart: daysAhead(1),
      plannedEnd: daysAhead(2),
      createdById: issaMasadeh.id,
    },
  });

  await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0005' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0005',
      productionOrderId: po5.id,
      skuId: skuMap['10310067'],    // Alwatani Blue HF 2.0kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'ON_HOLD',
      priority: 'MEDIUM',
      plannedQty: 600,
      actualQty: 200,
      goodQty: 198,
      scrapQty: 2,
      plannedStart: daysAgo(2),
      plannedEnd: daysAhead(1),
      actualStart: daysAgo(2),
      notes: 'On hold — waiting for packaging film delivery from supplier',
      createdById: issaMasadeh.id,
    },
  });

  await (prisma as any).workOrder.upsert({
    where: { orderNumber: 'WO-2026-0006' },
    update: {},
    create: {
      factoryId: sidco.id,
      orderNumber: 'WO-2026-0006',
      skuId: skuMap['10310113'],    // SIDCO Extra White Original LF 1.5kg
      machineId: bigBetti.id,
      lineId: sidcoPackingLine1.id,
      status: 'CANCELLED',
      priority: 'LOW',
      plannedQty: 400,
      actualQty: 0,
      goodQty: 0,
      scrapQty: 0,
      plannedStart: daysAgo(3),
      plannedEnd: daysAgo(2),
      notes: 'Cancelled — customer order postponed to next quarter',
      createdById: issaMasadeh.id,
    },
  });

  console.log(`✅ SIDCO work orders: 6 orders — COMPLETED×2, IN_PROGRESS×1, PLANNED×1, ON_HOLD×1, CANCELLED×1`);

  // ============================================================
  // SIDCO — INSPECTION RESULTS (ISA-95 QualityTestResult)
  // Linked to work orders above — includes PASS, CONDITIONAL, FAIL
  // ============================================================
  const qualityUser = await prisma.user.findFirst({ where: { email: 'quality@sidco.com.sa' } });
  const inspectorId = qualityUser?.id ?? mohammedYousef.id;

  const inspSeed = async (data: Record<string, any>) => {
    const existing = await (prisma as any).inspectionResult.findUnique({ where: { inspectionNumber: data.inspectionNumber } });
    if (!existing) await (prisma as any).inspectionResult.create({ data });
  };

  // INSP-2026-001 — INCOMING: STPP raw material lot check → PASS
  await inspSeed({
    factoryId: sidco.id,
    planId: qpIncoming.id,
    inspectionNumber: 'INSP-2026-001',
    type: 'INCOMING',
    result: 'PASS',
    totalQty: 5, passQty: 5, failQty: 0,
    measurements: [
      { parameterId: 'qp-param-inc-01', name: 'Moisture Content', value: 3.2, unit: '%',   pass: true },
      { parameterId: 'qp-param-inc-02', name: 'Bulk Density',     value: 658, unit: 'g/L', pass: true },
      { parameterId: 'qp-param-inc-03', name: 'pH (1% solution)', value: 10.6,unit: 'pH',  pass: true },
    ],
    inspectorId,
    inspectedAt: daysAgo(8),
    notes: 'LOT-STPP-2024-02 — all parameters within specification. Batch approved for production.',
  });

  // INSP-2026-002 — IN_PROCESS on WO-2026-0001 → PASS
  await inspSeed({
    factoryId: sidco.id,
    planId: qpInProcess.id,
    workOrderId: wo1.id,
    machineId: bigBetti.id,
    inspectionNumber: 'INSP-2026-002',
    type: 'IN_PROCESS',
    result: 'PASS',
    totalQty: 10, passQty: 10, failQty: 0,
    measurements: [
      { parameterId: 'qp-param-ip-01', name: 'Fill Weight',    value: 2252, unit: 'g',    pass: true },
      { parameterId: 'qp-param-ip-02', name: 'Seal Strength',  value: 12.5, unit: 'N',    pass: true },
      { parameterId: 'qp-param-ip-03', name: 'Cap Torque',     value: 8.2,  unit: 'N·cm', pass: true },
      { parameterId: 'qp-param-ip-04', name: 'Label Position', value: 0.5,  unit: 'mm',   pass: true },
    ],
    inspectorId,
    inspectedAt: daysAgo(7),
    notes: 'Mid-shift check — all parameters within SPC control limits.',
  });

  // INSP-2026-003 — FINAL on WO-2026-0001 → PASS (batch cleared for dispatch)
  await inspSeed({
    factoryId: sidco.id,
    planId: qpFinal.id,
    workOrderId: wo1.id,
    machineId: bigBetti.id,
    inspectionNumber: 'INSP-2026-003',
    type: 'FINAL',
    result: 'PASS',
    totalQty: 20, passQty: 20, failQty: 0,
    measurements: [
      { parameterId: 'qp-param-fn-01', name: 'Net Weight',        value: 2255, unit: 'g',           pass: true },
      { parameterId: 'qp-param-fn-02', name: 'Appearance Score',  value: 5,    unit: 'score (1-5)', pass: true },
      { parameterId: 'qp-param-fn-03', name: 'Barcode Read Rate', value: 100,  unit: '%',            pass: true },
      { parameterId: 'qp-param-fn-04', name: 'Carton Integrity',  value: 1,    unit: 'pass/fail',   pass: true },
    ],
    inspectorId,
    inspectedAt: new Date(daysAgo(7).getTime() + 9 * 3600000),
    notes: 'Pre-shipment final check — batch cleared for dispatch.',
  });

  // INSP-2026-004 — IN_PROCESS on WO-2026-0002 → CONDITIONAL (fill weight drift detected)
  await inspSeed({
    factoryId: sidco.id,
    planId: qpInProcess.id,
    workOrderId: wo2.id,
    machineId: bigBetti.id,
    inspectionNumber: 'INSP-2026-004',
    type: 'IN_PROCESS',
    result: 'CONDITIONAL',
    totalQty: 10, passQty: 9, failQty: 1,
    measurements: [
      { parameterId: 'qp-param-ip-01', name: 'Fill Weight',    value: 2195, unit: 'g',    pass: false, note: 'Below LSL 2200g — possible nozzle #3 blockage' },
      { parameterId: 'qp-param-ip-02', name: 'Seal Strength',  value: 11.8, unit: 'N',    pass: true  },
      { parameterId: 'qp-param-ip-03', name: 'Cap Torque',     value: 7.9,  unit: 'N·cm', pass: true  },
      { parameterId: 'qp-param-ip-04', name: 'Label Position', value: 1.2,  unit: 'mm',   pass: true  },
    ],
    inspectorId,
    inspectedAt: daysAgo(5),
    notes: 'Sample #3 fill weight below LSL (2195g vs 2200g minimum). Nozzle inspection recommended.',
  });

  // INSP-2026-005 — FINAL on WO-2026-0002 → FAIL (6/20 units below min weight → NCR raised)
  await inspSeed({
    factoryId: sidco.id,
    planId: qpFinal.id,
    workOrderId: wo2.id,
    machineId: bigBetti.id,
    inspectionNumber: 'INSP-2026-005',
    type: 'FINAL',
    result: 'FAIL',
    totalQty: 20, passQty: 14, failQty: 6,
    measurements: [
      { parameterId: 'qp-param-fn-01', name: 'Net Weight',        value: 2188, unit: 'g',           pass: false, note: '6 units measured at 2185–2208g, below 2210g LSL' },
      { parameterId: 'qp-param-fn-02', name: 'Appearance Score',  value: 4,    unit: 'score (1-5)', pass: true  },
      { parameterId: 'qp-param-fn-03', name: 'Barcode Read Rate', value: 100,  unit: '%',            pass: true  },
      { parameterId: 'qp-param-fn-04', name: 'Carton Integrity',  value: 1,    unit: 'pass/fail',   pass: true  },
    ],
    inspectorId,
    inspectedAt: new Date(daysAgo(5).getTime() + 8 * 3600000),
    notes: '6 out of 20 units below minimum fill weight spec. Batch held. NCR-2026-001 raised.',
  });

  // INSP-2026-006 — IN_PROCESS on WO-2026-0003 → PASS (current run, post nozzle-cleaning)
  await inspSeed({
    factoryId: sidco.id,
    planId: qpInProcess.id,
    workOrderId: wo3.id,
    machineId: bigBetti.id,
    inspectionNumber: 'INSP-2026-006',
    type: 'IN_PROCESS',
    result: 'PASS',
    totalQty: 10, passQty: 10, failQty: 0,
    measurements: [
      { parameterId: 'qp-param-ip-01', name: 'Fill Weight',    value: 2248, unit: 'g',    pass: true },
      { parameterId: 'qp-param-ip-02', name: 'Seal Strength',  value: 12.2, unit: 'N',    pass: true },
      { parameterId: 'qp-param-ip-03', name: 'Cap Torque',     value: 8.0,  unit: 'N·cm', pass: true },
      { parameterId: 'qp-param-ip-04', name: 'Label Position', value: 0.8,  unit: 'mm',   pass: true },
    ],
    inspectorId,
    inspectedAt: daysAgo(0),
    notes: 'Shift start check — all nominal after nozzle cleaning. Process back in SPC control.',
  });

  console.log(`✅ SIDCO inspections: 6 records — INCOMING×1 PASS, IN_PROCESS×3 (2 PASS, 1 CONDITIONAL), FINAL×2 (1 PASS, 1 FAIL)`);

  // ============================================================
  // SIDCO — NCR (Non-Conformance Reports)
  // ============================================================
  const ncr1 = await (prisma as any).nCR.upsert({
    where: { ncrNumber: 'NCR-2026-001' },
    update: {},
    create: {
      factoryId: sidco.id,
      ncrNumber: 'NCR-2026-001',
      title: 'Under-Fill Defect — GENTO Flower HF 2.25kg (WO-2026-0002)',
      description: 'Final inspection INSP-2026-005 found 6 out of 20 sampled units with net weight below the minimum specification of 2210g. Measured values ranged 2185–2208g. Root cause confirmed as partial blockage of filling nozzle #3 on Big Betti — nozzle was operating beyond its 500-hour recommended service interval (at 524 hours at time of failure).',
      severity: 'MAJOR',
      status: 'CAPA_PENDING',
      machineId: bigBetti.id,
      defectCategory: 'FILL_WEIGHT',
      quantity: 28,
      disposition: 'REWORK',
      detectedById: inspectorId,
      detectedAt: new Date(daysAgo(5).getTime() + 8 * 3600000),
      dueDate: daysAhead(2),
      rootCause: 'Partial blockage of filling nozzle #3 causing inconsistent powder flow. Nozzle was at 524 operating hours vs. 500-hour maximum service interval.',
    },
  });

  await (prisma as any).nCR.upsert({
    where: { ncrNumber: 'NCR-2026-002' },
    update: {},
    create: {
      factoryId: sidco.id,
      ncrNumber: 'NCR-2026-002',
      title: 'Label Misalignment — Alwatani Violet HF 2.0kg',
      description: 'Operator reported visible label misalignment (>3mm offset) on approximately 15 units during routine patrol check. Labels are outside the USL of ±3mm. Products are cosmetically non-conforming but functionally acceptable. Caused by incorrect label roll tension set after changeover.',
      severity: 'MINOR',
      status: 'RESOLVED',
      machineId: bigBetti.id,
      defectCategory: 'LABELING',
      quantity: 15,
      disposition: 'USE_AS_IS',
      detectedById: mohammedYousef.id,
      detectedAt: daysAgo(10),
      dueDate: daysAgo(3),
      rootCause: 'Label roll tension not correctly set after label changeover. SOP did not include a tension verification step.',
      resolvedAt: daysAgo(4),
      resolvedById: issaMasadeh.id,
    },
  });

  console.log(`✅ SIDCO NCRs: NCR-2026-001 (MAJOR, fill weight, CAPA_PENDING) + NCR-2026-002 (MINOR, labeling, RESOLVED)`);

  // ============================================================
  // SIDCO — CAPA (Corrective & Preventive Actions)
  // ============================================================
  const capa1 = await (prisma as any).cAPA.upsert({
    where: { capaNumber: 'CAPA-2026-001' },
    update: {},
    create: {
      factoryId: sidco.id,
      capaNumber: 'CAPA-2026-001',
      ncrId: ncr1.id,
      type: 'CORRECTIVE',
      title: 'Nozzle Cleaning & PM Schedule Interval Reduction',
      description: 'Corrective action for NCR-2026-001: (1) Immediate cleaning and inspection of all 6 Big Betti filling nozzles. (2) Reduce nozzle inspection interval from 500h to 250h in the preventive maintenance schedule. (3) Rework 28 under-filled units from WO-2026-0002 batch.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: mohammedYousef.id,
      dueDate: daysAhead(2),
    },
  });

  const capaActionSeed = async (capaId: string, id: string, data: Record<string, any>) => {
    const existing = await (prisma as any).cAPAAction.findUnique({ where: { id } });
    if (!existing) await (prisma as any).cAPAAction.create({ data: { id, capaId, ...data } });
  };

  await capaActionSeed(capa1.id, 'capa-act-001-01', {
    description: 'Disassemble, clean, and inspect all 6 filling nozzles on Big Betti (M1-BIG-BETTI)',
    assignedToId: mohammedYousef.id,
    dueDate: daysAgo(1),
    status: 'COMPLETED',
    completedAt: daysAgo(1),
    evidence: 'Nozzle #3 cleared — 3mm dry powder buildup found and removed. All nozzles back within tolerance. Photo reference: MAINT-LOG-2026-0612.',
  });

  await capaActionSeed(capa1.id, 'capa-act-001-02', {
    description: 'Update PM schedule: reduce nozzle inspection interval from 500h to 250h for Big Betti',
    assignedToId: issaMasadeh.id,
    dueDate: daysAhead(2),
    status: 'OPEN',
  });

  await capaActionSeed(capa1.id, 'capa-act-001-03', {
    description: 'Rework 28 under-filled units from WO-2026-0002 batch — re-fill and re-inspect',
    assignedToId: mohammedYousef.id,
    dueDate: daysAhead(1),
    status: 'IN_PROGRESS',
  });

  // Preventive CAPA for label changeover
  await (prisma as any).cAPA.upsert({
    where: { capaNumber: 'CAPA-2026-002' },
    update: {},
    create: {
      factoryId: sidco.id,
      capaNumber: 'CAPA-2026-002',
      type: 'PREVENTIVE',
      title: 'Label Tension Verification Step Added to Changeover SOP',
      description: 'Preventive action to eliminate label misalignment on changeovers: add mandatory label tension verification step (target: 3.5 N·m ± 0.5) to the standard changeover checklist. Operator must confirm reading before restart.',
      status: 'CLOSED',
      priority: 'MEDIUM',
      assignedToId: mohammedYousef.id,
      dueDate: daysAgo(3),
      completedAt: daysAgo(4),
      verifiedAt: daysAgo(3),
      verifiedById: issaMasadeh.id,
      effectiveness: 'Effective — zero label misalignment reported across 5 subsequent changeovers in 3-day verification period.',
    },
  });

  console.log(`✅ SIDCO CAPAs: CAPA-2026-001 (IN_PROGRESS, corrective, 3 actions) + CAPA-2026-002 (CLOSED, preventive)`);

  // ============================================================
  // SIDCO — SPC MEASUREMENTS (fill weight drift → recovery story)
  // Big Betti / GENTO Flower 2.25kg — 16 data points showing the NCR pattern
  // ============================================================
  const spcPoints = [
    // Normal operation (WO-2026-0001)
    { daysBack: 10,  value: 2253, out: false },
    { daysBack: 9.5, value: 2248, out: false },
    { daysBack: 9,   value: 2251, out: false },
    { daysBack: 8.5, value: 2249, out: false },
    { daysBack: 8,   value: 2255, out: false },
    // Drift begins (WO-2026-0002 — nozzle blockage building up)
    { daysBack: 6.5, value: 2240, out: false },
    { daysBack: 6,   value: 2233, out: false },
    { daysBack: 5.5, value: 2225, out: false },
    { daysBack: 5,   value: 2218, out: true  }, // below LCL 2220g
    { daysBack: 4.5, value: 2195, out: true  }, // below LSL 2200g — NCR raised
    // Gap (nozzle cleaned, rework in progress)
    // Recovery (WO-2026-0003 — post cleaning)
    { daysBack: 1.5, value: 2251, out: false },
    { daysBack: 1,   value: 2249, out: false },
    { daysBack: 0.5, value: 2252, out: false },
    { daysBack: 0,   value: 2248, out: false },
  ];

  for (let i = 0; i < spcPoints.length; i++) {
    const pt = spcPoints[i];
    const existing = await (prisma as any).sPCMeasurement.findFirst({
      where: { machineId: bigBetti.id, parameterName: 'Fill Weight', subgroupNumber: i + 1 },
    });
    if (!existing) {
      await (prisma as any).sPCMeasurement.create({
        data: {
          factoryId: sidco.id,
          machineId: bigBetti.id,
          skuId: skuMap['10310189'],
          parameterName: 'Fill Weight',
          parameterUnit: 'g',
          value: pt.value,
          sampleSize: 5,
          subgroupNumber: i + 1,
          workOrderId: pt.daysBack >= 4.5 ? wo2.id : wo3.id,
          measuredAt: daysAgo(pt.daysBack),
          measuredById: inspectorId,
          isOutOfControl: pt.out,
          controlViolation: pt.out ? 'RULE_1' : null,
          ucl: 2280, lcl: 2220, cl: 2250, usl: 2300, lsl: 2200,
        },
      });
    }
  }

  console.log(`✅ SIDCO SPC: 14 fill-weight data points — drift pattern + recovery visible in SPC chart`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 NCC MES Platform seed completed successfully!');
  console.log('═'.repeat(60));
  console.log('\n📋 LOGIN CREDENTIALS (all use Password@123):');
  console.log('');
  console.log('  SUPER ADMIN (all factories):');
  console.log('    admin@mes360.sa      → SUPER_ADMIN');
  console.log('    soliman@mes360.sa    → SUPER_ADMIN');
  console.log('');
  console.log('  SIDCO (PoC Factory):');
  console.log('    issa.masadeh@sidco.com.sa    → FACTORY_ADMIN');
  console.log('    mohammed.brakat@sidco.com.sa  → PLANT_MANAGER');
  console.log('    mohammed.yousef@sidco.com.sa  → PRODUCTION_SUPERVISOR');
  console.log('    operator@sidco.com.sa          → OPERATOR');
  console.log('    maintenance@sidco.com.sa       → MAINTENANCE_TECHNICIAN');
  console.log('    quality@sidco.com.sa           → QUALITY_ENGINEER');
  console.log('');
  console.log('  Demo data summary:');
  console.log('    Production Orders: PO-NCC-1050 → PO-NCC-1054 (COMPLETED×2, IN_PROGRESS×1, RELEASED×1, ON_HOLD×1)');
  console.log('    Work Orders: WO-2026-0001 → WO-2026-0006 (all statuses, linked to POs)');
  console.log('    Quality Plans: QP-RM-SIDCO-001 (INCOMING), QP-IP-LINE1-001 (IN_PROCESS), QP-FN-GENTO-001 (FINAL)');
  console.log('    Inspections: INSP-2026-001 → 006 (PASS, CONDITIONAL, FAIL scenarios)');
  console.log('    NCR: NCR-2026-001 (fill weight, CAPA_PENDING), NCR-2026-002 (labeling, RESOLVED)');
  console.log('    CAPA: CAPA-2026-001 (corrective, IN_PROGRESS), CAPA-2026-002 (preventive, CLOSED)');
  console.log('    SPC: 14 fill-weight data points with visible drift + recovery pattern');
  console.log('');
  // ── Dashboard Center catalog ───────────────────────────────────
  await seedDashboardCenter(prisma);

  // ── IoT / Energy demo (PLCs + counters + power meters) ─────────
  await seedIotEnergyDemo(prisma);

  console.log('  Platform: http://localhost:3000');
  console.log('  API Docs: http://localhost:3001/api/docs');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
