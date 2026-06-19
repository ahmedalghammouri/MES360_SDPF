import type { ModbusDataType, RegisterType, WordOrder } from './types';

/**
 * Standardised energy/power-meter register templates. Selecting a template
 * auto-creates the meter's ENERGY tags (separate from machine tags) with the
 * right register binding, scaling, unit and energy role.
 *
 * NOTE: register addresses follow each vendor's published Modbus map and are
 * 0-based protocol offsets. Real devices occasionally differ by ±1 or by
 * firmware — every field is editable in the UI after the template is applied.
 * Instantaneous electrical values are IEEE-754 Float32 (wordCount 2);
 * energy counters are 64-bit integers (wordCount 4).
 */

/** Canonical role a meter tag plays (drives EnergyReading + UI labels). */
export type EnergyRole =
  | 'ACTIVE_POWER_TOTAL' | 'REACTIVE_POWER_TOTAL' | 'APPARENT_POWER_TOTAL'
  | 'ENERGY_IMPORT_TOTAL' | 'ENERGY_EXPORT_TOTAL'
  | 'VOLTAGE_L1' | 'VOLTAGE_L2' | 'VOLTAGE_L3' | 'VOLTAGE_AVG' | 'VOLTAGE_LL_AVG'
  | 'CURRENT_L1' | 'CURRENT_L2' | 'CURRENT_L3' | 'CURRENT_AVG'
  | 'ACTIVE_POWER_L1' | 'ACTIVE_POWER_L2' | 'ACTIVE_POWER_L3'
  | 'PF_TOTAL' | 'PF_L1' | 'PF_L2' | 'PF_L3'
  | 'FREQUENCY' | 'THD_V' | 'THD_I';

export interface MeterTagSpec {
  /** Short code suffix (prefixed with the meter number to form a unique tag code). */
  key: string;
  name: string;
  energyRole: EnergyRole;
  registerType: RegisterType;
  address: number;
  wordCount: 1 | 2 | 4;
  wordOrder: WordOrder;
  dataType: ModbusDataType;
  unit: string;
  scaleFactor?: number;
}

export interface MeterTemplate {
  key: string;
  label: string;
  manufacturer: string;
  models: string[]; // catalog/order numbers this template fits
  tags: MeterTagSpec[];
}

const F = (key: string, name: string, energyRole: EnergyRole, address: number, unit: string, scaleFactor?: number): MeterTagSpec =>
  ({ key, name, energyRole, registerType: 'HOLDING', address, wordCount: 2, wordOrder: 'BIG', dataType: 'FLOAT', unit, ...(scaleFactor ? { scaleFactor } : {}) });
const I64 = (key: string, name: string, energyRole: EnergyRole, address: number, unit: string, scaleFactor?: number): MeterTagSpec =>
  ({ key, name, energyRole, registerType: 'HOLDING', address, wordCount: 4, wordOrder: 'BIG', dataType: 'INT', unit, ...(scaleFactor ? { scaleFactor } : {}) });

// Schneider PowerLogic PM5100 series (PM5110) — Float32 instantaneous + Int64 energy.
const SCHNEIDER_PM5110: MeterTemplate = {
  key: 'SCHNEIDER_PM5110',
  label: 'Schneider PowerLogic PM5110',
  manufacturer: 'Schneider Electric',
  models: ['METSEPM5110', 'PM5100'],
  tags: [
    F('I_A', 'Current L1', 'CURRENT_L1', 3000, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 3002, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 3004, 'A'),
    F('I_AVG', 'Current Avg', 'CURRENT_AVG', 3010, 'A'),
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 3028, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3030, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 3032, 'V'),
    F('V_LN_AVG', 'Voltage L-N Avg', 'VOLTAGE_AVG', 3036, 'V'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 3060, 'kW'),
    F('Q_TOTAL', 'Reactive Power Total', 'REACTIVE_POWER_TOTAL', 3068, 'kVAR'),
    F('S_TOTAL', 'Apparent Power Total', 'APPARENT_POWER_TOTAL', 3076, 'kVA'),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 3084, ''),
    F('FREQ', 'Frequency', 'FREQUENCY', 3110, 'Hz'),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 3204, 'kWh', 0.001),
    I64('E_EXP', 'Active Energy Export', 'ENERGY_EXPORT_TOTAL', 3208, 'kWh', 0.001),
  ],
};

// Siemens SENTRON PAC3200 — Float32 map (per-phase + totals).
const SIEMENS_PAC3200: MeterTemplate = {
  key: 'SIEMENS_PAC3200',
  label: 'Siemens SENTRON PAC3200',
  manufacturer: 'Siemens',
  models: ['7KM2111', 'PAC3200'],
  tags: [
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 1, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 5, 'V'),
    F('I_A', 'Current L1', 'CURRENT_L1', 13, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 15, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 17, 'A'),
    F('P_A', 'Active Power L1', 'ACTIVE_POWER_L1', 25, 'kW', 0.001),
    F('P_B', 'Active Power L2', 'ACTIVE_POWER_L2', 27, 'kW', 0.001),
    F('P_C', 'Active Power L3', 'ACTIVE_POWER_L3', 29, 'kW', 0.001),
    F('FREQ', 'Frequency', 'FREQUENCY', 55, 'Hz'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 65, 'kW', 0.001),
    F('Q_TOTAL', 'Reactive Power Total', 'REACTIVE_POWER_TOTAL', 67, 'kVAR', 0.001),
    F('S_TOTAL', 'Apparent Power Total', 'APPARENT_POWER_TOTAL', 63, 'kVA', 0.001),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 69, ''),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 801, 'kWh'),
  ],
};

// Siemens SENTRON PAC2200 — essential Float32 map.
const SIEMENS_PAC2200: MeterTemplate = {
  key: 'SIEMENS_PAC2200',
  label: 'Siemens SENTRON PAC2200',
  manufacturer: 'Siemens',
  models: ['7KM2200', 'PAC2200'],
  tags: [
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 1, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 5, 'V'),
    F('I_A', 'Current L1', 'CURRENT_L1', 13, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 15, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 17, 'A'),
    F('FREQ', 'Frequency', 'FREQUENCY', 55, 'Hz'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 65, 'kW', 0.001),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 69, ''),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 801, 'kWh'),
  ],
};

// Generic 3-phase power meter — minimal essential set (Float32 holding regs from 0).
const GENERIC_PM: MeterTemplate = {
  key: 'GENERIC_PM',
  label: 'Generic 3-phase Power Meter',
  manufacturer: 'Generic',
  models: ['custom'],
  tags: [
    F('V_AVG', 'Voltage Avg', 'VOLTAGE_AVG', 0, 'V'),
    F('I_AVG', 'Current Avg', 'CURRENT_AVG', 2, 'A'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 4, 'kW'),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 6, ''),
    F('FREQ', 'Frequency', 'FREQUENCY', 8, 'Hz'),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 10, 'kWh'),
  ],
};

export const METER_TEMPLATES: MeterTemplate[] = [
  SCHNEIDER_PM5110, SIEMENS_PAC3200, SIEMENS_PAC2200, GENERIC_PM,
];

export function getMeterTemplate(key: string): MeterTemplate | undefined {
  return METER_TEMPLATES.find((t) => t.key === key);
}

/** Payload for creating one tag (subset of TagDefinition fields). */
export interface MeterTagCreate {
  code: string;
  name: string;
  dataType: ModbusDataType;
  tagType: 'ENERGY';
  unit: string;
  address: string;
  registerType: RegisterType;
  wordCount: number;
  wordOrder: WordOrder;
  scaleFactor: number | null;
  energyRole: EnergyRole;
}

/**
 * Build tag-create payloads for a meter from a template. Codes are prefixed
 * with the meter number so they're globally unique (e.g. `EM-PM-01_P_TOTAL`).
 */
export function instantiateMeterTags(templateKey: string, meterNumber: string): MeterTagCreate[] {
  const tpl = getMeterTemplate(templateKey);
  if (!tpl) return [];
  return tpl.tags.map((t) => ({
    code: `${meterNumber}_${t.key}`,
    name: t.name,
    dataType: t.dataType,
    tagType: 'ENERGY',
    unit: t.unit,
    address: String(t.address),
    registerType: t.registerType,
    wordCount: t.wordCount,
    wordOrder: t.wordOrder,
    scaleFactor: t.scaleFactor ?? null,
    energyRole: t.energyRole,
  }));
}
