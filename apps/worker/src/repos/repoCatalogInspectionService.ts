import { findRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import { getRepoRunActionsMetadata } from '@sniptail/core/repos/runActions.js';
import { normalizeRepoKey } from './repoCatalogMutationService.js';

export type RepoCatalogInspectSummary = {
  repoKey: string;
  provider: string;
  baseBranch: string;
  sourceType: 'localPath' | 'sshUrl';
  source: string;
  projectId?: number;
  runActionCount: number;
  runActionIds: string[];
  runMetadataSyncedAt?: string;
  runMetadataSourceRef?: string;
};

export type RepoCatalogInspectResult = {
  command: 'inspect';
  repoKey: string;
  normalizedFrom?: string;
  entry: RepoRow;
  summary: RepoCatalogInspectSummary;
};

function summarizeRepoRow(row: RepoRow): RepoCatalogInspectSummary {
  const sourceType = row.localPath ? 'localPath' : 'sshUrl';
  const source = row.localPath ?? row.sshUrl ?? '';
  const runMetadata = getRepoRunActionsMetadata(row.providerData);
  const runActionIds = Object.keys(runMetadata?.actions ?? {}).sort((a, b) => a.localeCompare(b));

  return {
    repoKey: row.repoKey,
    provider: row.provider,
    baseBranch: row.baseBranch,
    sourceType,
    source,
    ...(row.projectId !== undefined ? { projectId: row.projectId } : {}),
    runActionCount: runActionIds.length,
    runActionIds,
    ...(runMetadata?.syncedAt ? { runMetadataSyncedAt: runMetadata.syncedAt } : {}),
    ...(runMetadata?.sourceRef ? { runMetadataSourceRef: runMetadata.sourceRef } : {}),
  };
}

export async function inspectRepoCatalogEntryFromInput(
  repoKeyInput: string,
): Promise<RepoCatalogInspectResult> {
  const { repoKey, normalized } = normalizeRepoKey(repoKeyInput);
  const entry = await findRepoCatalogEntry(repoKey);
  if (!entry) {
    throw new Error(`Repository key "${repoKey}" was not found in the active catalog.`);
  }

  return {
    command: 'inspect',
    repoKey,
    ...(normalized ? { normalizedFrom: repoKeyInput } : {}),
    entry,
    summary: summarizeRepoRow(entry),
  };
}
