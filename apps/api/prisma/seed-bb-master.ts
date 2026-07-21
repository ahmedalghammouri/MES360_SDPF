// ============================================================
// MES360° — SDPF / BIG BETTI PRODUCTS + RAW MATERIALS + BOM RESET
// ------------------------------------------------------------
// Full targeted reset of the SDPF product & material master, rebuilt
// 1:1 from the two source files in:
//     docs/master data inventory/
//       • BB Item (3).xlsx                     → finished products (SKUs)
//       • sdpf big betti production details.xlsx → BOM (products ⇄ components)
//
// What it does:
//   1. TRUNCATE ... CASCADE on skus + raw_materials + product lookups.
//      This wipes those tables AND everything that references them
//      (BOMs, cycle times, production/work orders, batches, lots,
//       consumption, manufacturing processes, recipes, …). Destructive.
//   2. Rebuilds product lookups (category / brands / base units / weights
//      / packaging types) from the file data.
//   3. Recreates raw materials from the distinct BOM components.
//   4. Recreates SKUs from the union of both files.
//   5. Rebuilds the BOM (BOMHeader + BOMItem, and the denormalised
//      BOMComponent rows) per product.
//
// Factory / storage / units of measure are looked up (not recreated) —
// run the master seed first if the DB is empty.
//
// Run:  npx ts-node prisma/seed-bb-master.ts
//       (or)  npm run prisma:seed:bb   (see package.json)
// ============================================================

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient, StorageZone } from '@prisma/client';

const prisma = new PrismaClient();

const FACTORY_CODE = 'SDPF';

// Resolve the source-file directory. Works on the dev host (repo `docs/`)
// AND inside the Docker image (`prisma/master-data`, which is copied in — the
// repo `docs/` folder is NOT). Override with BB_MASTER_DIR if you mount the
// files elsewhere (e.g. `docker exec -e BB_MASTER_DIR=/data …`).
const CANDIDATE_DIRS = [
  process.env.BB_MASTER_DIR,
  path.resolve(__dirname, 'master-data'), // shipped inside the image
  path.resolve(__dirname, '../../../docs/master data inventory'), // repo dev host
].filter(Boolean) as string[];

const DOCS_DIR =
  CANDIDATE_DIRS.find((d) => fs.existsSync(path.join(d, 'BB Item (3).xlsx'))) ?? CANDIDATE_DIRS[0];
const BB_ITEM_FILE = path.join(DOCS_DIR, 'BB Item (3).xlsx');
const BOM_FILE = path.join(DOCS_DIR, 'sdpf big betti production details.xlsx');

// ────────────────────────────────────────────────────────────
// Source-file row shapes
// ────────────────────────────────────────────────────────────
interface BbItemRow {
  itemNumber: string;
  name: string;
  pcInCarton: number; // "PC IN CARTON"
  pallet: number; // cartons per pallet
}
interface BomRow {
  code: string; // finished-product item number
  description: string;
  uom: string; // finished-product UOM (CTN)
  workcenter: string;
  componentItem: string;
  componentDescription: string;
  componentUom: string; // KG | PC
  supplySubinventory: string; // SF01 (powder) | WP01 (packaging)
  bomQty: number; // quantity per 1 finished unit (carton)
  hourlyTarget: number; // "1 HR Machine Target"
}

// ────────────────────────────────────────────────────────────
// Helpers — parse the SKU naming convention
// ────────────────────────────────────────────────────────────
/** "6X2 Kg" / "4x2.25 Kg" → { packPerCarton, weight } */
function parsePack(name: string): { packPerCarton: number; weight: number } {
  const m = name.match(/(\d+)\s*[xX]\s*([\d.]+)\s*Kg/i);
  if (!m) return { packPerCarton: 1, weight: 1 };
  return { packPerCarton: parseInt(m[1], 10), weight: parseFloat(m[2]) };
}
/** brand = text before "Powder Detergent" */
function parseBrand(name: string): string {
  const b = name.split(/powder detergent/i)[0].trim();
  return b
    .replace(/SIDCO EXtra White/i, 'SIDCO Extra White')
    .replace(/^REX$/i, 'Rex');
}
const foamType = (name: string): 'HF' | 'LF' => (/\bLF\b/i.test(name) ? 'LF' : 'HF');

/** Category for a raw-material / component code, by SAP number prefix. */
function componentCategory(code: string): 'RAW' | 'PACKAGING' | 'CONSUMABLE' {
  if (code.startsWith('203')) return 'RAW'; // bulk detergent powder
  if (code.startsWith('3031')) return 'CONSUMABLE'; // glue
  if (code.startsWith('4012')) return 'PACKAGING'; // stretch film
  return 'PACKAGING'; // 4025 pallet · 4031 top sheet · 4032 case · 4033 inner carton
}

// ────────────────────────────────────────────────────────────
// Excel readers
// ────────────────────────────────────────────────────────────
function readSheet(file: string): any[][] {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: null });
}

function readBbItems(): BbItemRow[] {
  const rows = readSheet(BB_ITEM_FILE).slice(1); // drop header
  const out: BbItemRow[] = [];
  for (const r of rows) {
    if (r[1] == null) continue;
    out.push({
      itemNumber: String(r[1]).trim(),
      name: String(r[2] ?? '').trim(),
      pcInCarton: Number(r[3]) || 1,
      pallet: Number(r[4]) || 0,
    });
  }
  return out;
}

function readBom(): BomRow[] {
  const rows = readSheet(BOM_FILE).slice(1); // drop header
  const out: BomRow[] = [];
  for (const r of rows) {
    if (r[1] == null || r[5] == null) continue; // separator / blank rows
    out.push({
      code: String(r[1]).trim(),
      description: String(r[2] ?? '').trim(),
      uom: String(r[3] ?? 'CTN').trim(),
      workcenter: String(r[4] ?? '').trim(),
      componentItem: String(r[5]).trim(),
      componentDescription: String(r[6] ?? '').trim(),
      componentUom: String(r[7] ?? 'PC').trim().toUpperCase(),
      supplySubinventory: String(r[8] ?? '').trim(),
      bomQty: Number(r[9]) || 0,
      hourlyTarget: Number(r[10]) || 0,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 SDPF / Big Betti products + raw materials + BOM reset\n');

  // 1. Look up factory + supporting master data (NOT recreated here).
  const factory = await prisma.factory.findFirst({ where: { code: FACTORY_CODE } });
  if (!factory) {
    throw new Error(
      `Factory "${FACTORY_CODE}" not found. Run the master seed (prisma:seed:master) first.`,
    );
  }

  const storages = await prisma.storageLocation.findMany({ where: { factoryId: factory.id } });
  const storageByZone = new Map<StorageZone, string>();
  for (const s of storages) if (!storageByZone.has(s.zone)) storageByZone.set(s.zone, s.id);
  const rawZone = storageByZone.get(StorageZone.RAW_MATERIAL) ?? null;
  const fgZone = storageByZone.get(StorageZone.FINISHED_GOODS) ?? null;

  const uoms = await prisma.unitOfMeasure.findMany({ where: { factoryId: factory.id } });
  const uomByCode = new Map(uoms.map((u) => [u.code.toUpperCase(), u.id]));
  /** File uses "PC" for pieces; the seeded UOM code is "PCS". */
  const resolveUom = (code: string): string | null =>
    uomByCode.get(code.toUpperCase()) ??
    (code.toUpperCase() === 'PC' ? uomByCode.get('PCS') ?? null : null);

  // 2. Read the source files.
  const bbItems = readBbItems();
  const bomRows = readBom();
  console.log(`📄 BB Item rows: ${bbItems.length}   ·   BOM lines: ${bomRows.length}`);

  // ──────────────────────────────────────────────────────────
  // 3. TRUNCATE — products, raw materials, product lookups + all
  //    dependents (CASCADE). This is the destructive reset.
  // ──────────────────────────────────────────────────────────
  const wipe = [
    'skus',
    'raw_materials',
    'product_categories',
    'product_brands',
    'packaging_types',
    'base_units',
    'base_weights',
  ]
    .map((t) => `"${t}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${wipe} RESTART IDENTITY CASCADE`);
  console.log('🧨 Reset: products, raw materials, BOM & all dependent rows cleared');

  // ──────────────────────────────────────────────────────────
  // 4. Raw materials — one per distinct BOM component.
  // ──────────────────────────────────────────────────────────
  const componentMap = new Map<string, BomRow>();
  for (const r of bomRows) if (!componentMap.has(r.componentItem)) componentMap.set(r.componentItem, r);

  const rawMaterialId = new Map<string, string>(); // componentItem → RawMaterial.id
  for (const [code, r] of componentMap) {
    const category = componentCategory(code);
    const unit = r.componentUom || (category === 'RAW' ? 'KG' : 'PC');
    const row = await prisma.rawMaterial.create({
      data: {
        factoryId: factory.id,
        code,
        name: r.componentDescription || code,
        category,
        unit,
        unitId: resolveUom(unit),
        currentStock: 0,
        minStock: 0,
        storageLocationId: rawZone,
      },
    });
    rawMaterialId.set(code, row.id);
  }
  console.log(`✅ Raw materials: ${rawMaterialId.size}`);

  // ──────────────────────────────────────────────────────────
  // 5. Build the merged product list (union of both files).
  //    BB Item is the primary master; production-details supplies
  //    a few extra codes (Al Watani 4×4) + workcenter / hourly target.
  // ──────────────────────────────────────────────────────────
  interface ProductDef {
    itemNumber: string;
    name: string;
    innersPerCarton: number;
    cartonsPerPallet: number;
    workcenter?: string;
    hourlyTarget?: number;
  }
  const products = new Map<string, ProductDef>();

  for (const it of bbItems) {
    if (products.has(it.itemNumber)) {
      console.warn(`   ⚠︎ duplicate item number ${it.itemNumber} ("${it.name}") — keeping first, skipping`);
      continue;
    }
    products.set(it.itemNumber, {
      itemNumber: it.itemNumber,
      name: it.name,
      innersPerCarton: it.pcInCarton,
      cartonsPerPallet: it.pallet,
    });
  }

  // Enrich existing + add production-details-only products.
  for (const r of bomRows) {
    const existing = products.get(r.code);
    if (existing) {
      existing.workcenter = r.workcenter || existing.workcenter;
      existing.hourlyTarget = r.hourlyTarget || existing.hourlyTarget;
    } else {
      const { packPerCarton } = parsePack(r.description);
      products.set(r.code, {
        itemNumber: r.code,
        name: r.description,
        innersPerCarton: packPerCarton,
        cartonsPerPallet: 40,
        workcenter: r.workcenter,
        hourlyTarget: r.hourlyTarget,
      });
    }
  }
  console.log(`📦 Products (union): ${products.size}`);

  // ──────────────────────────────────────────────────────────
  // 6. Product lookups — category / brands / base units / weights / packaging.
  // ──────────────────────────────────────────────────────────
  const defs = [...products.values()];

  const category = await prisma.productCategory.create({
    data: { factoryId: factory.id, name: 'Powder Detergent', nameAr: 'مسحوق غسيل' },
  });

  const brandNames = [...new Set(defs.map((d) => parseBrand(d.name)).filter(Boolean))];
  const brandId = new Map<string, string>();
  for (let i = 0; i < brandNames.length; i++) {
    const row = await prisma.productBrand.create({
      data: { factoryId: factory.id, name: brandNames[i], sortOrder: i },
    });
    brandId.set(brandNames[i], row.id);
  }

  const cartonUnit = await prisma.baseUnit.create({
    data: { factoryId: factory.id, code: 'CARTON', name: 'Carton', sortOrder: 0 },
  });

  const weights = [...new Set(defs.map((d) => parsePack(d.name).weight))].sort((a, b) => a - b);
  const weightId = new Map<number, string>();
  for (let i = 0; i < weights.length; i++) {
    const row = await prisma.baseWeight.create({
      data: { factoryId: factory.id, value: weights[i], unit: 'kg', label: `${weights[i]} Kg`, sortOrder: i },
    });
    weightId.set(weights[i], row.id);
  }

  const packLabels = [
    ...new Set(defs.map((d) => {
      const { packPerCarton, weight } = parsePack(d.name);
      return `${packPerCarton}×${weight} Kg Carton`;
    })),
  ];
  const packId = new Map<string, string>();
  for (let i = 0; i < packLabels.length; i++) {
    const row = await prisma.packagingType.create({
      data: { factoryId: factory.id, name: packLabels[i], sortOrder: i },
    });
    packId.set(packLabels[i], row.id);
  }
  console.log(
    `✅ Lookups: 1 category · ${brandNames.length} brands · ${weights.length} weights · ${packLabels.length} packaging types`,
  );

  // ──────────────────────────────────────────────────────────
  // 7. SKUs.
  // ──────────────────────────────────────────────────────────
  const skuId = new Map<string, string>(); // itemNumber → SKU.id
  for (const d of defs) {
    const { packPerCarton, weight } = parsePack(d.name);
    const brand = parseBrand(d.name);
    const packLabel = `${packPerCarton}×${weight} Kg Carton`;
    const foam = foamType(d.name);
    const row = await prisma.sKU.create({
      data: {
        factoryId: factory.id,
        itemNumber: d.itemNumber,
        code: d.itemNumber,
        name: d.name,
        shortName: `${brand} ${weight}Kg ${foam}`.trim(),
        brand,
        category: category.name,
        categoryId: category.id,
        brandId: brandId.get(brand) ?? null,
        packagingTypeId: packId.get(packLabel) ?? null,
        baseUnitId: cartonUnit.id,
        baseWeightId: weightId.get(weight) ?? null,
        weight,
        weightUnit: 'kg',
        packagingType: packLabel,
        unitsPerInner: 1,
        innersPerCarton: d.innersPerCarton || packPerCarton || 1,
        cartonsPerPallet: d.cartonsPerPallet || 1,
        baseUnit: 'CARTON',
        storageLocationId: fgZone,
        metadata: {
          foam,
          workcenter: d.workcenter ?? null,
          hourlyTarget: d.hourlyTarget ?? null,
        },
      },
    });
    skuId.set(d.itemNumber, row.id);
  }
  console.log(`✅ SKUs: ${skuId.size}`);

  // ──────────────────────────────────────────────────────────
  // 8. BOM — BOMHeader + BOMItem (canonical) and denormalised
  //    BOMComponent rows, one per finished product that has lines.
  // ──────────────────────────────────────────────────────────
  const linesByProduct = new Map<string, BomRow[]>();
  for (const r of bomRows) {
    if (!linesByProduct.has(r.code)) linesByProduct.set(r.code, []);
    linesByProduct.get(r.code)!.push(r);
  }

  let headerCount = 0;
  let itemCount = 0;
  for (const [code, lines] of linesByProduct) {
    const sku = skuId.get(code);
    if (!sku) {
      console.warn(`   ⚠︎ BOM for ${code} skipped — no matching SKU`);
      continue;
    }
    const header = await prisma.bOMHeader.create({
      data: {
        factoryId: factory.id,
        skuId: sku,
        version: '1.0',
        isActive: true,
        notes: 'Imported from "sdpf big betti production details.xlsx"',
      },
    });
    headerCount++;

    for (const l of lines) {
      const rmId = rawMaterialId.get(l.componentItem);
      if (!rmId) continue;
      const type = componentCategory(l.componentItem);
      await prisma.bOMItem.create({
        data: {
          bomId: header.id,
          rawMaterialId: rmId,
          quantityPer: l.bomQty,
          unit: l.componentUom,
          unitId: resolveUom(l.componentUom),
        },
      });
      await prisma.bOMComponent.create({
        data: {
          skuId: sku,
          componentCode: l.componentItem,
          componentName: l.componentDescription || l.componentItem,
          quantity: l.bomQty,
          unit: l.componentUom,
          type,
        },
      });
      itemCount++;
    }
  }
  console.log(`✅ BOM: ${headerCount} headers · ${itemCount} lines`);

  console.log('\n🎉 Done — SDPF product & material master rebuilt from files.\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
