import { existsSync } from 'node:fs';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isSniptailRoot(dir: string): boolean {
  if (!existsSync(join(dir, 'scripts', 'register-loaders.mjs'))) return false;
  const hasApps = existsSync(join(dir, 'apps', 'bot')) || existsSync(join(dir, 'apps', 'worker'));
  if (!hasApps) return false;
  const hasConfig =
    existsSync(join(dir, 'sniptail.bot.toml')) || existsSync(join(dir, 'sniptail.worker.toml'));
  return hasConfig;
}

function findRootFrom(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (isSniptailRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveSniptailRoot(options: { cwd?: string; root?: string } = {}): string {
  const candidates = [
    process.env.SNIPTAIL_ROOT,
    options.root,
    options.cwd,
    dirname(fileURLToPath(import.meta.url)),
  ].filter((value): value is string => Boolean(value && value.length));

  for (const candidate of candidates) {
    const found = findRootFrom(candidate);
    if (found) return found;
  }

  throw new Error('Could not locate the Sniptail install root. Use --root to specify it.');
}

export function resolvePath(base: string, input: string): string {
  return resolve(base, input);
}

export function resolveOptionalPath(base: string, input?: string | null): string | undefined {
  if (!input) return undefined;
  return resolve(base, input);
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}

export function pathIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
