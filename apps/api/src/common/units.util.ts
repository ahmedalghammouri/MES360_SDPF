/**
 * Packaging-ladder unit conversion. A product (SKU) defines how its base unit
 * rolls up: PIECE → INNER (×unitsPerInner) → CARTON (×innersPerCarton) →
 * PALLET (×cartonsPerPallet). Production quantities recorded at different routing
 * steps are in DIFFERENT units (filling in inners, cartoning in cartons,
 * palletising in pallets), so they can only be summed/compared after converting
 * to a common base unit — otherwise "180 cartons + 3 pallets" is nonsense.
 */

export interface SkuPackaging {
  unitsPerInner?: number | null;
  innersPerCarton?: number | null;
  cartonsPerPallet?: number | null;
  baseUnit?: string | null;
}

/** Pieces contained in one of each packaging unit, for this SKU. */
export function piecesPer(pkg: SkuPackaging | null | undefined): Record<string, number> {
  const inner = pkg?.unitsPerInner || 1;
  const carton = (pkg?.innersPerCarton || 1) * inner;
  const pallet = (pkg?.cartonsPerPallet || 1) * carton;
  return { PIECE: 1, EA: 1, PCS: 1, UNIT: 1, INNER: inner, CARTON: carton, PALLET: pallet };
}

/** Quantity in raw pieces (the smallest unit), given the unit it was counted in. */
export function toPieces(qty: number, fromUnit: string | null | undefined, pkg: SkuPackaging | null | undefined): number {
  const f = piecesPer(pkg);
  return qty * (f[(fromUnit || 'PIECE').toUpperCase()] ?? 1);
}

/** Quantity expressed in the SKU's declared base unit (e.g. CARTON / EA). */
export function toBaseUnits(qty: number, fromUnit: string | null | undefined, pkg: SkuPackaging | null | undefined): number {
  const f = piecesPer(pkg);
  const base = f[(pkg?.baseUnit || 'PIECE').toUpperCase()] ?? 1;
  return toPieces(qty, fromUnit, pkg) / base;
}

/** Convert between two packaging units of the same SKU. */
export function convertUnits(qty: number, fromUnit: string, toUnit: string, pkg: SkuPackaging | null | undefined): number {
  const f = piecesPer(pkg);
  const from = f[(fromUnit || 'PIECE').toUpperCase()] ?? 1;
  const to = f[(toUnit || 'PIECE').toUpperCase()] ?? 1;
  return (qty * from) / to;
}
