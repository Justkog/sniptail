import { getTomlNumber, getTomlString, getTomlStringArray } from './toml.js';
import type { AgentId } from '../types/job.js';
import os from 'node:os';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseCommaList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanValue(raw: string, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid ${name} value: ${raw}. Use true/false.`);
}

export function resolveOptionalFlagFromSources(
  name: string,
  tomlValue: unknown,
  defaultValue = false,
): boolean {
  const raw = process.env[name];
  if (raw !== undefined) return parseBooleanValue(raw, name);
  if (tomlValue === undefined) return defaultValue;
  if (typeof tomlValue === 'boolean') return tomlValue;
  if (typeof tomlValue === 'string') return parseBooleanValue(tomlValue, `${name} (toml)`);
  throw new Error(`Invalid ${name} in TOML. Use true/false.`);
}

export function resolveStringValue(
  envName: string,
  tomlValue: unknown,
  options: { required?: boolean; defaultValue?: string } = {},
): string | undefined {
  const envRaw = process.env[envName];
  if (envRaw !== undefined) {
    const trimmed = envRaw.trim();
    if (trimmed !== '') return trimmed;
  }
  const tomlString = getTomlString(tomlValue, envName);
  if (tomlString !== undefined) {
    const trimmed = tomlString.trim();
    if (trimmed !== '') return trimmed;
  }
  if (options.defaultValue !== undefined) return options.defaultValue;
  if (options.required) throw new Error(`Missing required config: ${envName}`);
  return undefined;
}

function expandHomePath(value: string): string {
  const home = os.homedir();
  if (value === '~') return home;
  if (value.startsWith('~/')) return `${home}/${value.slice(2)}`;
  if (value === '$HOME') return home;
  if (value.startsWith('$HOME/')) return `${home}/${value.slice(6)}`;
  if (value === '${HOME}') return home;
  if (value.startsWith('${HOME}/')) return `${home}/${value.slice(8)}`;
  return value;
}

export function resolvePathValue(
  envName: string,
  tomlValue: unknown,
  options: { required?: boolean; defaultValue?: string } = {},
): string | undefined {
  const raw = resolveStringValue(envName, tomlValue, options);
  if (!raw) return raw;
  return expandHomePath(raw);
}

export function resolveStringArrayFromSources(envName: string, tomlValue: unknown): string[] {
  const envRaw = process.env[envName];
  if (envRaw !== undefined) return parseCommaList(envRaw);
  const tomlArray = getTomlStringArray(tomlValue, envName);
  return tomlArray ?? [];
}

export function resolveBotName(tomlValue: unknown): string {
  const rawBotName = resolveStringValue('BOT_NAME', tomlValue);
  return rawBotName ? rawBotName : 'Sniptail';
}

export function resolveJobRegistryDriver(tomlValue: unknown): 'sqlite' | 'pg' {
  const raw = (
    resolveStringValue('JOB_REGISTRY_DB', tomlValue, { defaultValue: 'sqlite' }) || 'sqlite'
  )
    .trim()
    .toLowerCase();
  if (raw !== 'sqlite' && raw !== 'pg') {
    throw new Error(`Invalid JOB_REGISTRY_DB: ${raw}`);
  }
  return raw;
}

export function resolveJobRegistryPgUrl(driver: 'sqlite' | 'pg'): string | undefined {
  if (driver !== 'pg') return undefined;
  return requireEnv('JOB_REGISTRY_PG_URL');
}

export function resolvePrimaryAgent(tomlValue: unknown): AgentId {
  const raw = (resolveStringValue('PRIMARY_AGENT', tomlValue, { defaultValue: 'codex' }) || 'codex')
    .trim()
    .toLowerCase();
  if (raw !== 'codex' && raw !== 'copilot') {
    throw new Error(`Invalid PRIMARY_AGENT: ${raw}`);
  }
  return raw;
}

export function resolveCopilotExecutionMode(tomlValue: unknown): 'local' | 'docker' {
  const raw = (
    resolveStringValue('GH_COPILOT_EXECUTION_MODE', tomlValue, {
      defaultValue: 'local',
    }) || 'local'
  )
    .trim()
    .toLowerCase();
  if (raw !== 'local' && raw !== 'docker') {
    throw new Error(`Invalid GH_COPILOT_EXECUTION_MODE: ${raw}`);
  }
  return raw;
}

export function resolveCopilotIdleRetries(tomlValue: unknown): number {
  const raw = process.env.COPILOT_IDLE_RETRIES;
  if (raw !== undefined && raw.trim() !== '') {
    const normalized = raw.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`Invalid COPILOT_IDLE_RETRIES: ${raw}`);
    }
    const value = Number.parseInt(normalized, 10);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid COPILOT_IDLE_RETRIES: ${raw}`);
    }
    return value;
  }
  const tomlNumber = getTomlNumber(tomlValue, 'COPILOT_IDLE_RETRIES');
  if (tomlNumber !== undefined) {
    if (!Number.isInteger(tomlNumber) || tomlNumber < 0) {
      throw new Error(`Invalid COPILOT_IDLE_RETRIES: ${tomlNumber}`);
    }
    return tomlNumber;
  }
  return 2;
}

export function resolveCodexExecutionMode(tomlValue: unknown): 'local' | 'docker' {
  const raw = (
    resolveStringValue('CODEX_EXECUTION_MODE', tomlValue, { defaultValue: 'local' }) || 'local'
  )
    .trim()
    .toLowerCase();
  if (raw !== 'local' && raw !== 'docker') {
    throw new Error(`Invalid CODEX_EXECUTION_MODE: ${raw}`);
  }
  return raw;
}
