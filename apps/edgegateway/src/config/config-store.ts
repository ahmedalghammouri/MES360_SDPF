import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime config overrides persisted to `gateway-config.json` next to the
 * executable/working dir. These take precedence over `.env` and are editable
 * from the dashboard Settings page (applied on restart). Keeping them in a
 * separate file means the dashboard can rewrite config without touching `.env`.
 */
export interface StoredConfig {
  gatewayName?: string;
  factoryCode?: string;
  databaseUrl?: string;
  mqttBrokerUrl?: string;
  influxUrl?: string;
  influxToken?: string;
  influxOrg?: string;
  influxBucket?: string;
  mesPlatformUrl?: string;
  defaultPollIntervalMs?: number;
}

export function configPath(): string {
  return process.env.GATEWAY_CONFIG_FILE || resolve(process.cwd(), 'gateway-config.json');
}

export function readConfigFile(): StoredConfig {
  try {
    return existsSync(configPath()) ? (JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfigFile(patch: StoredConfig): StoredConfig {
  const merged = { ...readConfigFile(), ...patch };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return merged;
}
