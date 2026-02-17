import 'dotenv/config';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { expandHomePath } from '@sniptail/core/config/resolve.js';
import { closeJobRegistryDb } from '@sniptail/core/db/index.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { inferRepoProvider } from '@sniptail/core/repos/providers.js';
import { closeRepoCatalogStore } from '@sniptail/core/repos/catalogStore.js';
import {
  deactivateRepoCatalogEntry,
  findRepoCatalogEntry,
  listRepoCatalogEntries,
  syncAllowlistFileFromCatalog,
  upsertRepoCatalogEntry,
  type RepoProvider,
} from '@sniptail/core/repos/catalog.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';

type AddResult = 'created' | 'updated' | 'skipped';

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: repos <command> [options]',
      '',
      'Commands:',
      '  add <repoKey>      Add or update a repository catalog entry',
      '  list               List active repository catalog entries',
      '  remove <repoKey>   Deactivate a repository catalog entry',
      '  sync-file          Write DB catalog entries to an allowlist JSON file',
      '',
      'Examples:',
      '  repos add my-api --ssh-url git@github.com:org/my-api.git',
      '  repos add payments --ssh-url git@gitlab.com:org/payments.git --project-id 12345',
      '  repos add local-tools --local-path /srv/repos/local-tools',
      '  repos list --json',
      '  repos remove my-api --yes',
      '  repos sync-file',
      '',
    ].join('\n'),
  );
}

function resolveInputPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Path value cannot be empty.');
  }
  const expanded = expandHomePath(trimmed);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

function parseRepoProvider(raw?: string): RepoProvider | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Invalid --provider value: expected a non-empty string.');
  }
  return normalized;
}

function parseProjectId(raw?: string): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid --project-id value: ${raw}. Expected a positive integer.`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --project-id value: ${raw}. Expected a positive integer.`);
  }
  return parsed;
}

function inferProviderFromInput(repo: RepoConfig): RepoProvider {
  return inferRepoProvider(repo);
}

function normalizeRepoKey(input: string): { repoKey: string; normalized: boolean } {
  const repoKey = sanitizeRepoKey(input);
  if (!repoKey) {
    throw new Error('Repository key must include letters or numbers.');
  }
  return { repoKey, normalized: repoKey !== input };
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function formatRows(rows: Array<Record<string, string>>): string {
  const headers = ['repoKey', 'provider', 'baseBranch', 'source', 'projectId'] as const;
  const widths = headers.map((header) => header.length);

  for (const row of rows) {
    headers.forEach((header, index) => {
      const value = row[header] ?? '';
      widths[index] = Math.max(widths[index] ?? 0, value.length);
    });
  }

  const headerLine = headers
    .map((header, index) => header.padEnd(widths[index] ?? header.length))
    .join('  ');
  const divider = headers
    .map((header, index) => ''.padEnd(widths[index] ?? header.length, '-'))
    .join('  ');
  const lines = rows.map((row) =>
    headers
      .map((header, index) => (row[header] ?? '').padEnd(widths[index] ?? header.length))
      .join('  '),
  );

  return [headerLine, divider, ...lines].join('\n');
}

async function syncConfiguredAllowlistFile(
  allowlistPath?: string,
): Promise<{ synced: boolean; count?: number; path?: string }> {
  if (!allowlistPath) return { synced: false };
  const count = await syncAllowlistFileFromCatalog(allowlistPath);
  return { synced: true, count, path: allowlistPath };
}

async function handleAdd(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      'ssh-url': { type: 'string' },
      'local-path': { type: 'string' },
      'project-id': { type: 'string' },
      'base-branch': { type: 'string' },
      provider: { type: 'string' },
      'if-missing': { type: 'boolean', default: false },
      upsert: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });

  if (parsed.positionals.length !== 1) {
    throw new Error('Usage: repos add <repoKey> [--ssh-url ... | --local-path ...] [options]');
  }

  const config = loadWorkerConfig();
  const repoKeyInput = parsed.positionals[0] ?? '';
  const { repoKey, normalized } = normalizeRepoKey(repoKeyInput);

  const sshUrl = parsed.values['ssh-url']?.trim();
  const localPathRaw = parsed.values['local-path']?.trim();
  const projectId = parseProjectId(parsed.values['project-id']);
  const baseBranch = parsed.values['base-branch']?.trim();
  const providerOption = parseRepoProvider(parsed.values.provider);
  const ifMissing = Boolean(parsed.values['if-missing']);
  const upsert = Boolean(parsed.values.upsert);
  const asJson = Boolean(parsed.values.json);

  if (ifMissing && upsert) {
    throw new Error('Cannot use --if-missing and --upsert together.');
  }
  if (!sshUrl && !localPathRaw) {
    throw new Error('Either --ssh-url or --local-path is required.');
  }
  if (sshUrl && localPathRaw) {
    throw new Error('--ssh-url and --local-path are mutually exclusive.');
  }

  const repoConfig: RepoConfig = {
    ...(sshUrl ? { sshUrl } : {}),
    ...(localPathRaw ? { localPath: resolveInputPath(localPathRaw) } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(projectId !== undefined ? { providerData: { projectId } } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  };

  const effectiveProvider = providerOption ?? inferProviderFromInput(repoConfig);
  if (effectiveProvider === 'local' && repoConfig.projectId !== undefined) {
    throw new Error('--project-id is only valid for GitLab repositories.');
  }

  const existing = await findRepoCatalogEntry(repoKey);
  let result: AddResult = 'created';
  if (existing) {
    if (ifMissing) {
      result = 'skipped';
    } else if (upsert) {
      result = 'updated';
    } else {
      throw new Error(
        `Repository key "${repoKey}" already exists. Use --upsert to replace or --if-missing to skip.`,
      );
    }
  }

  let syncResult: { synced: boolean; count?: number; path?: string } = { synced: false };
  if (result !== 'skipped') {
    await upsertRepoCatalogEntry(repoKey, repoConfig, { provider: effectiveProvider });
    syncResult = await syncConfiguredAllowlistFile(config.repoAllowlistPath);
  }

  const payload = {
    command: 'add',
    result,
    repoKey,
    provider: effectiveProvider,
    ...(normalized ? { normalizedFrom: repoKeyInput } : {}),
    ...(syncResult.synced
      ? {
          syncedFile: {
            path: syncResult.path,
            count: syncResult.count,
          },
        }
      : {}),
  };

  if (asJson) {
    writeJson(payload);
    return;
  }

  if (normalized) {
    process.stdout.write(`Using normalized repo key: ${repoKey}\n`);
  }
  if (result === 'skipped') {
    process.stdout.write(`Skipped: repository key "${repoKey}" already exists.\n`);
  } else if (result === 'updated') {
    process.stdout.write(`Updated repository entry "${repoKey}".\n`);
  } else {
    process.stdout.write(`Added repository entry "${repoKey}".\n`);
  }
  if (syncResult.synced) {
    process.stdout.write(
      `Synchronized allowlist file at ${syncResult.path} (${syncResult.count ?? 0} entries).\n`,
    );
  }
}

async function handleList(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });

  if (parsed.positionals.length > 0) {
    throw new Error('Usage: repos list [--provider <provider>] [--json]');
  }

  loadWorkerConfig();
  const provider = parseRepoProvider(parsed.values.provider);
  const asJson = Boolean(parsed.values.json);
  const entries = await listRepoCatalogEntries();
  const filtered = provider ? entries.filter((entry) => entry.provider === provider) : entries;

  if (asJson) {
    writeJson({
      command: 'list',
      count: filtered.length,
      entries: filtered,
    });
    return;
  }

  if (!filtered.length) {
    process.stdout.write('No repositories are currently registered.\n');
    return;
  }

  const rows = filtered.map((entry) => ({
    repoKey: entry.repoKey,
    provider: entry.provider,
    baseBranch: entry.baseBranch,
    source: entry.localPath ?? entry.sshUrl ?? '',
    projectId: entry.projectId !== undefined ? String(entry.projectId) : '',
  }));
  process.stdout.write(`${formatRows(rows)}\n`);
}

async function confirmRemoval(repoKey: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Use --yes when running in a non-interactive shell.');
  }
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const response = await rl.question(
      `Deactivate repository "${repoKey}" from the catalog? [y/N] `,
    );
    return ['y', 'yes'].includes(response.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function handleRemove(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });

  if (parsed.positionals.length !== 1) {
    throw new Error('Usage: repos remove <repoKey> [--yes] [--json]');
  }

  const config = loadWorkerConfig();
  const repoKeyInput = parsed.positionals[0] ?? '';
  const { repoKey, normalized } = normalizeRepoKey(repoKeyInput);
  const asJson = Boolean(parsed.values.json);
  const yes = Boolean(parsed.values.yes);

  if (!yes) {
    const confirmed = await confirmRemoval(repoKey);
    if (!confirmed) {
      if (asJson) {
        writeJson({
          command: 'remove',
          result: 'cancelled',
          repoKey,
          ...(normalized ? { normalizedFrom: repoKeyInput } : {}),
        });
      } else {
        process.stdout.write('Cancelled.\n');
      }
      return;
    }
  }

  const removed = await deactivateRepoCatalogEntry(repoKey);
  if (!removed) {
    throw new Error(`Repository key "${repoKey}" was not found in the active catalog.`);
  }

  const syncResult = await syncConfiguredAllowlistFile(config.repoAllowlistPath);
  const payload = {
    command: 'remove',
    result: 'removed',
    repoKey,
    ...(normalized ? { normalizedFrom: repoKeyInput } : {}),
    ...(syncResult.synced
      ? {
          syncedFile: {
            path: syncResult.path,
            count: syncResult.count,
          },
        }
      : {}),
  };

  if (asJson) {
    writeJson(payload);
    return;
  }

  if (normalized) {
    process.stdout.write(`Using normalized repo key: ${repoKey}\n`);
  }
  process.stdout.write(`Removed repository entry "${repoKey}".\n`);
  if (syncResult.synced) {
    process.stdout.write(
      `Synchronized allowlist file at ${syncResult.path} (${syncResult.count ?? 0} entries).\n`,
    );
  }
}

async function handleSyncFile(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      path: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });

  if (parsed.positionals.length > 0) {
    throw new Error('Usage: repos sync-file [--path <file>] [--json]');
  }

  const config = loadWorkerConfig();
  const asJson = Boolean(parsed.values.json);
  const targetPath = parsed.values.path?.trim()
    ? resolveInputPath(parsed.values.path)
    : config.repoAllowlistPath;
  if (!targetPath) {
    throw new Error(
      'repo_allowlist_path (or REPO_ALLOWLIST_PATH) is not configured. Pass --path to override.',
    );
  }

  const count = await syncAllowlistFileFromCatalog(targetPath);
  if (asJson) {
    writeJson({
      command: 'sync-file',
      path: targetPath,
      count,
    });
    return;
  }

  process.stdout.write(`Synchronized allowlist file at ${targetPath} (${count} entries).\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exitCode = command ? 0 : 1;
    return;
  }

  switch (command) {
    case 'add':
      await handleAdd(args);
      return;
    case 'list':
      await handleList(args);
      return;
    case 'remove':
      await handleRemove(args);
      return;
    case 'sync-file':
      await handleSyncFile(args);
      return;
    default:
      throw new Error(`Unknown repos command: ${command}`);
  }
}

void main()
  .catch((err) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.stderr.write('Run this command with `--help` for usage.\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeRepoCatalogStore();
    } catch (err) {
      process.stderr.write(
        `Warning: Failed to close repo catalog store: ${(err as Error).message}\n`,
      );
    }

    try {
      await closeJobRegistryDb();
    } catch (err) {
      process.stderr.write(`Warning: Failed to close job registry DB: ${(err as Error).message}\n`);
    }
  });
