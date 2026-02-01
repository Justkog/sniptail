import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { logger } from '../logger.js';

export type TomlTable = Record<string, unknown>;

export function resolveConfigPath(envName: string, defaultPath: string): string {
  const raw = process.env[envName]?.trim();
  const resolved = raw && raw.length ? raw : defaultPath;
  return resolve(process.cwd(), resolved);
}

export function loadTomlConfig(envName: string, defaultPath: string, label: string): TomlTable {
  const path = resolveConfigPath(envName, defaultPath);
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseToml(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} config TOML must be a table at the root.`);
    }
    return parsed as TomlTable;
  } catch (err) {
    logger.error({ err, path }, `Failed to load ${label} config TOML`);
    throw err;
  }
}

export function getTomlTable(value: unknown, name: string): TomlTable | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as TomlTable;
  }
  throw new Error(`Invalid ${name} in TOML. Expected a table.`);
}

export function getTomlString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`Invalid ${name} in TOML. Expected a string.`);
}

export function getTomlNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Invalid ${name} in TOML. Expected a number.`);
}

export function getTomlStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${name} in TOML. Expected an array.`);
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  if (strings.length !== value.length) {
    throw new Error(`Invalid ${name} in TOML. Expected an array of strings.`);
  }
  return strings;
}
