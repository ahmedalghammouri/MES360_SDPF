/**
 * Factory-selector types. All factory data (branding, coordinates and KPIs)
 * comes live from `GET /auth/factories/overview` — there is no static list.
 */

export interface Factory {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr?: string;
  district?: string;
  districtAr?: string;
  /** Real-world WGS84 coordinates */
  lat: number;
  lng: number;
  color: string;
  glowColor: string;
  isActive?: boolean;
  kpis: FactoryKPI;
}

export interface FactoryKPI {
  oee: number;
  production: number;
  productionUnit?: string;
  quality: number;
  availability: number;
  performance: number;
  activeAlarms: number;
  employees: number;
  shiftsToday: number;
  uptime: number;
}
