// ============================================================
// MES360° — FACILITY COORDINATES (dashboard / network map)
// ------------------------------------------------------------
// Applies the facility locations the client supplied as Google Maps links, so the
// pins on the manufacturing-network map sit on the real sites.
//
// The five links resolve to:
//
//   SIDCO  https://maps.app.goo.gl/eQPmPB48CgjsSj34A
//          → "Saudi Industrial Detergents Company"      26.2539087, 49.9876848
//   SDPF   https://maps.app.goo.gl/PYQT8hM7hsVLnuV18
//          → "Saudi detergent powder factory (sdpf)"    25.9267784, 49.9469883
//   SAF    https://maps.app.goo.gl/m8po6Ysbv1AoAiqS7
//          → "SIDCO Aerosol Factory"                    25.9265816, 49.9448726
//   RNTIC  https://maps.app.goo.gl/N9GvhpLf3tyyhM4JA
//          → Dammam 34326 (EIDA3448)                    26.2524912, 49.9857344
//   NDPF   https://maps.app.goo.gl/bSRxZDGSTE29uzND9
//          → "المصنع الوطني لصابون البودرة", Jeddah        21.4112773, 39.2425602
//
// ⚠  TWO FACILITIES CHANGE REGION
// -------------------------------
// The seeded data had RNTIC in Jeddah and NDPF in Dammam. The client's links put
// them the other way round — RNTIC in Dammam's 2nd Industrial City and NDPF in
// Jeddah. The Jeddah pin resolves to "National Powder Soap Factory", which matches
// NDPF's name, so the seeded pair looks to have been transposed and these links
// correct it. Worth confirming verbally before the review.
//
// A NULL coordinate drops the pin AND hides the facility from the network list,
// so every row is verified non-null afterwards.
//
// Idempotent: a plain UPDATE keyed on factory code. No other column is touched
// beyond city/address, which are corrected to match the new pins.
//
// Run:  docker exec mes-api npx ts-node prisma/seed-factory-coordinates.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Site {
  code: string;
  lat: number;
  lng: number;
  city: string;
  cityAr: string;
  address: string;
  mapsLink: string;
  resolvedAs: string;
}

const SITES: Site[] = [
  {
    code: 'SDPF',
    lat: 25.9267784,
    lng: 49.9469883,
    city: 'Dammam',
    cityAr: 'الدمام',
    address: '3rd Industrial City, Dammam, Eastern Province',
    mapsLink: 'https://maps.app.goo.gl/PYQT8hM7hsVLnuV18',
    resolvedAs: 'Saudi detergent powder factory (sdpf)',
  },
  {
    code: 'SIDCO',
    lat: 26.2539087,
    lng: 49.9876848,
    city: 'Dammam',
    cityAr: 'الدمام',
    address: '2nd Industrial City, Dammam 34326, Eastern Province',
    mapsLink: 'https://maps.app.goo.gl/eQPmPB48CgjsSj34A',
    resolvedAs: 'Saudi Industrial Detergents Company',
  },
  {
    code: 'SAF',
    lat: 25.9265816,
    lng: 49.9448726,
    city: 'Dammam',
    cityAr: 'الدمام',
    address: '3rd Industrial City, Dammam, Eastern Province',
    mapsLink: 'https://maps.app.goo.gl/m8po6Ysbv1AoAiqS7',
    resolvedAs: 'SIDCO Aerosol Factory',
  },
  {
    code: 'RNTIC',
    lat: 26.2524912,
    lng: 49.9857344,
    city: 'Dammam',
    cityAr: 'الدمام',
    address: '2nd Industrial City, Dammam 34326, Eastern Province',
    mapsLink: 'https://maps.app.goo.gl/N9GvhpLf3tyyhM4JA',
    resolvedAs: 'EIDA3448, Dammam 34326 — moved from Jeddah, please confirm',
  },
  {
    code: 'NDPF',
    lat: 21.4112773,
    lng: 39.2425602,
    city: 'Jeddah',
    cityAr: 'جدة',
    address: 'Jeddah, Makkah Province',
    mapsLink: 'https://maps.app.goo.gl/bSRxZDGSTE29uzND9',
    resolvedAs: 'المصنع الوطني لصابون البودرة (National Powder Soap Factory) — moved from Dammam, please confirm',
  },
];

/** Metres between two WGS84 points — used only to report how far each pin moved. */
function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function main() {
  console.log('🌍 Facility coordinates — applying the client-supplied Google Maps locations\n');

  let updated = 0;
  const missing: string[] = [];

  for (const s of SITES) {
    const before = await prisma.factory.findFirst({
      where: { code: s.code },
      select: { id: true, name: true, lat: true, lng: true, city: true },
    });
    if (!before) {
      missing.push(s.code);
      console.log(`   ⚠  ${s.code.padEnd(6)} not found — skipped`);
      continue;
    }

    await prisma.factory.update({
      where: { id: before.id },
      data: { lat: s.lat, lng: s.lng, city: s.city, address: s.address },
    });
    updated++;

    const movedM =
      before.lat != null && before.lng != null
        ? haversineM(before.lat, before.lng, s.lat, s.lng)
        : null;
    const moved =
      movedM == null ? 'was NULL' : movedM > 1000 ? `${(movedM / 1000).toFixed(1)} km` : `${Math.round(movedM)} m`;
    const cityChanged = before.city !== s.city ? `  city ${before.city} → ${s.city}` : '';

    console.log(
      `   ✓ ${s.code.padEnd(6)} ${s.lat.toFixed(7)}, ${s.lng.toFixed(7)}   moved ${moved.padEnd(9)}${cityChanged}`,
    );
    console.log(`     ${s.resolvedAs}`);
  }

  // A factory with a NULL coordinate silently disappears from the map AND the
  // facilities list, so make the check explicit rather than trusting the writes.
  const nullPins = await prisma.factory.findMany({
    where: { OR: [{ lat: null }, { lng: null }] },
    select: { code: true, name: true },
  });

  console.log('\n' + '═'.repeat(66));
  console.log(`✅ ${updated}/${SITES.length} facilities updated`);
  if (missing.length) console.log(`   ⚠  not found in this database: ${missing.join(', ')}`);
  if (nullPins.length) {
    console.log(`   ❌ ${nullPins.length} factory row(s) still have a NULL coordinate and will not render:`);
    for (const f of nullPins) console.log(`      ${f.code} — ${f.name}`);
  } else {
    console.log('   Every factory has a coordinate — all pins will render.');
  }
  console.log('═'.repeat(66));
  console.log('\n   The dashboard reads these live from GET /auth/factories/overview,');
  console.log('   so a browser refresh is enough — no rebuild needed.\n');
}

main()
  .catch((e) => {
    console.error('❌ Update failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
