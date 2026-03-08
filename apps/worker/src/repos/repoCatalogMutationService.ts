import { isAbsolute, resolve } from 'node:path';
import { expandHomePath } from '@sniptail/core/config/resolve.js';
import { sanitizeRepoKey } from '@sniptail/core/git/keys.js';
import { inferRepoProvider } from '@sniptail/core/repos/providers.js';
import {
  deactivateRepoCatalogEntry,
  findRepoCatalogEntry,
  syncAllowlistFileFromCatalog,
  type RepoProvider,
  upsertRepoCatalogEntry,
} from '@sniptail/core/repos/catalog.js';
import type { RepoConfig } from '@sniptail/core/types/job.js';

export type RepoCatalogSyncResult = {
  synced: boolean;
  count?: number;
  path?: string;
};

export type RepoCatalogAddMutationResult = {
  command: 'add';
  result: 'created' | 'updated' | 'skipped';
  repoKey: string;
  provider: RepoProvider;
  normalizedFrom?: string;
  syncedFile?: {
    path: string;
    count: number;
  };
};

export type RepoCatalogRemoveMutationResult = {
  command: 'remove';
  result: 'removed';
  repoKey: string;
  normalizedFrom?: string;
  syncedFile?: {
    path: string;
    count: number;
  };
};

export type RepoCatalogAddMutationInput = {
  repoKeyInput: string;
  sshUrl: string | undefined;
  localPath: string | undefined;
  projectId: string | number | undefined;
  baseBranch: string | undefined;
  provider: string | undefined;
  ifMissing: boolean | undefined;
  upsert: boolean | undefined;
  allowlistPath: string | undefined;
};

export type RepoCatalogRemoveMutationInput = {
  repoKeyInput: string;
  allowlistPath: string | undefined;
};

export function resolveInputPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Path value cannot be empty.');
  }
  const expanded = expandHomePath(trimmed);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

export function parseRepoProvider(raw?: string): RepoProvider | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Invalid provider value: expected a non-empty string.');
  }
  return normalized;
}

export function parseProjectId(raw?: string | number): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      throw new Error(`Invalid project id value: ${raw}. Expected a positive integer.`);
    }
    return raw;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid project id value: ${raw}. Expected a positive integer.`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid project id value: ${raw}. Expected a positive integer.`);
  }
  return parsed;
}

export function normalizeRepoKey(input: string): { repoKey: string; normalized: boolean } {
  const repoKey = sanitizeRepoKey(input);
  if (!repoKey) {
    throw new Error('Repository key must include letters or numbers.');
  }
  return { repoKey, normalized: repoKey !== input };
}

async function syncConfiguredAllowlistFile(allowlistPath?: string): Promise<RepoCatalogSyncResult> {
  if (!allowlistPath) return { synced: false };
  const count = await syncAllowlistFileFromCatalog(allowlistPath);
  return { synced: true, count, path: allowlistPath };
}

export async function addRepoCatalogEntryFromInput(
  input: RepoCatalogAddMutationInput,
): Promise<RepoCatalogAddMutationResult> {
  const { repoKey, normalized } = normalizeRepoKey(input.repoKeyInput);
  const sshUrl = input.sshUrl?.trim();
  const localPathRaw = input.localPath?.trim();
  const projectId = parseProjectId(input.projectId);
  const baseBranch = input.baseBranch?.trim();
  const providerOption = parseRepoProvider(input.provider);
  const ifMissing = Boolean(input.ifMissing);
  const upsert = Boolean(input.upsert);

  if (ifMissing && upsert) {
    throw new Error('Cannot use ifMissing and upsert together.');
  }
  if (!sshUrl && !localPathRaw) {
    throw new Error('Either sshUrl or localPath is required.');
  }
  if (sshUrl && localPathRaw) {
    throw new Error('sshUrl and localPath are mutually exclusive.');
  }

  const repoConfig: RepoConfig = {
    ...(sshUrl ? { sshUrl } : {}),
    ...(localPathRaw ? { localPath: resolveInputPath(localPathRaw) } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(projectId !== undefined ? { providerData: { projectId } } : {}),
    ...(baseBranch ? { baseBranch } : {}),
  };

  const effectiveProvider = providerOption ?? inferRepoProvider(repoConfig);
  if (effectiveProvider === 'local' && repoConfig.projectId !== undefined) {
    throw new Error('projectId is only valid for GitLab repositories.');
  }

  const existing = await findRepoCatalogEntry(repoKey);
  let result: RepoCatalogAddMutationResult['result'] = 'created';
  if (existing) {
    if (ifMissing) {
      result = 'skipped';
    } else if (upsert) {
      result = 'updated';
    } else {
      throw new Error(
        `Repository key "${repoKey}" already exists. Use upsert to replace or ifMissing to skip.`,
      );
    }
  }

  let syncResult: RepoCatalogSyncResult = { synced: false };
  if (result !== 'skipped') {
    await upsertRepoCatalogEntry(repoKey, repoConfig, { provider: effectiveProvider });
    syncResult = await syncConfiguredAllowlistFile(input.allowlistPath);
  }

  return {
    command: 'add',
    result,
    repoKey,
    provider: effectiveProvider,
    ...(normalized ? { normalizedFrom: input.repoKeyInput } : {}),
    ...(syncResult.synced
      ? {
          syncedFile: {
            path: syncResult.path ?? '',
            count: syncResult.count ?? 0,
          },
        }
      : {}),
  };
}

export async function removeRepoCatalogEntryFromInput(
  input: RepoCatalogRemoveMutationInput,
): Promise<RepoCatalogRemoveMutationResult> {
  const { repoKey, normalized } = normalizeRepoKey(input.repoKeyInput);
  const removed = await deactivateRepoCatalogEntry(repoKey);
  if (!removed) {
    throw new Error(`Repository key "${repoKey}" was not found in the active catalog.`);
  }

  const syncResult = await syncConfiguredAllowlistFile(input.allowlistPath);
  return {
    command: 'remove',
    result: 'removed',
    repoKey,
    ...(normalized ? { normalizedFrom: input.repoKeyInput } : {}),
    ...(syncResult.synced
      ? {
          syncedFile: {
            path: syncResult.path ?? '',
            count: syncResult.count ?? 0,
          },
        }
      : {}),
  };
}
