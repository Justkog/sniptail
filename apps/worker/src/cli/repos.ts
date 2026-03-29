import 'dotenv/config';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { closeJobRegistryDb } from '@sniptail/core/db/index.js';
import { closeRepoCatalogStore } from '@sniptail/core/repos/catalogStore.js';
import {
  listRepoCatalogEntries,
  syncAllowlistFileFromCatalog,
} from '@sniptail/core/repos/catalog.js';
import { syncRunActionMetadata } from '../repos/syncRunActionMetadata.js';
import {
  addRepoCatalogEntryFromInput,
  normalizeRepoKey,
  parseRepoProvider,
  type RepoCatalogRemoveMutationResult,
  resolveInputPath,
  removeRepoCatalogEntryFromInput,
} from '../repos/repoCatalogMutationService.js';

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
      '  sync-run-actions   Sync per-repo run action metadata from .sniptail/run',
      '',
      'Examples:',
      '  repos add my-api --ssh-url git@github.com:org/my-api.git',
      '  repos add payments --ssh-url git@gitlab.com:org/payments.git --project-id 12345',
      '  repos add local-tools --local-path /srv/repos/local-tools',
      '  repos list --json',
      '  repos remove my-api --yes',
      '  repos sync-file',
      '  repos sync-run-actions',
      '',
    ].join('\n'),
  );
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
  const asJson = Boolean(parsed.values.json);
  const payload = await addRepoCatalogEntryFromInput({
    repoKeyInput: parsed.positionals[0] ?? '',
    sshUrl: parsed.values['ssh-url'],
    localPath: parsed.values['local-path'],
    projectId: parsed.values['project-id'],
    baseBranch: parsed.values['base-branch'],
    provider: parsed.values.provider,
    ifMissing: parsed.values['if-missing'],
    upsert: parsed.values.upsert,
    allowlistPath: config.repoAllowlistPath,
  });

  if (asJson) {
    writeJson(payload);
    return;
  }

  if (payload.normalizedFrom) {
    process.stdout.write(`Using normalized repo key: ${payload.repoKey}\n`);
  }
  if (payload.result === 'skipped') {
    process.stdout.write(`Skipped: repository key "${payload.repoKey}" already exists.\n`);
  } else if (payload.result === 'updated') {
    process.stdout.write(`Updated repository entry "${payload.repoKey}".\n`);
  } else {
    process.stdout.write(`Added repository entry "${payload.repoKey}".\n`);
  }
  if (payload.syncedFile) {
    process.stdout.write(
      `Synchronized allowlist file at ${payload.syncedFile.path} (${payload.syncedFile.count ?? 0} entries).\n`,
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
  const asJson = Boolean(parsed.values.json);
  const yes = Boolean(parsed.values.yes);
  const repoKeyInput = parsed.positionals[0] ?? '';
  const { repoKey } = normalizeRepoKey(repoKeyInput);

  if (!yes) {
    const confirmed = await confirmRemoval(repoKey);
    if (!confirmed) {
      if (asJson) {
        writeJson({
          command: 'remove',
          result: 'cancelled',
          repoKey,
          ...(repoKey !== repoKeyInput ? { normalizedFrom: repoKeyInput } : {}),
        });
      } else {
        process.stdout.write('Cancelled.\n');
      }
      return;
    }
  }

  const payload: RepoCatalogRemoveMutationResult = await removeRepoCatalogEntryFromInput({
    repoKeyInput,
    allowlistPath: config.repoAllowlistPath,
  });

  if (asJson) {
    writeJson(payload);
    return;
  }

  if (payload.normalizedFrom) {
    process.stdout.write(`Using normalized repo key: ${payload.repoKey}\n`);
  }
  process.stdout.write(`Removed repository entry "${payload.repoKey}".\n`);
  if (payload.syncedFile) {
    process.stdout.write(
      `Synchronized allowlist file at ${payload.syncedFile.path} (${payload.syncedFile.count ?? 0} entries).\n`,
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

async function handleSyncRunActions(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  if (parsed.positionals.length > 0) {
    throw new Error('Usage: repos sync-run-actions [--repo <repoKey>] [--json]');
  }

  loadWorkerConfig();
  const repoInput = parsed.values.repo?.trim();
  const repoKey = repoInput ? normalizeRepoKey(repoInput).repoKey : undefined;
  const asJson = Boolean(parsed.values.json);

  const result = await syncRunActionMetadata({ ...(repoKey ? { repoKey } : {}) });

  if (asJson) {
    writeJson({
      command: 'sync-run-actions',
      ...(repoKey ? { repoKey } : {}),
      ...result,
    });
    return;
  }

  process.stdout.write(
    `Synchronized run action metadata for ${result.updated}/${result.scanned} repositories.\n`,
  );
  if (result.failures.length) {
    process.stdout.write('Failures:\n');
    for (const failure of result.failures) {
      process.stdout.write(`- ${failure.repoKey}: ${failure.message}\n`);
    }
  }
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
    case 'sync-run-actions':
      await handleSyncRunActions(args);
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
