import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkerAgentCommandConfig } from '@sniptail/core/config/types.js';

export type ResolveAgentWorkspaceInput = {
  workspaceKey: string;
  cwd?: string;
};

export type ResolveAgentWorkspaceOptions = {
  requireExists?: boolean;
};

export type ResolvedAgentWorkspaceDisplay = {
  workspaceKey: string;
  label?: string;
  description?: string;
  name: string;
  cwd?: string;
};

export type ResolvedAgentWorkspace = {
  workspaceKey: string;
  workspaceRoot: string;
  resolvedCwd: string;
  relativeCwd?: string;
  label?: string;
  description?: string;
  display: ResolvedAgentWorkspaceDisplay;
};

function normalizeOptionalCwd(rawCwd: string | undefined): string | undefined {
  if (rawCwd === undefined) return undefined;
  const trimmed = rawCwd.trim();
  return trimmed ? trimmed : undefined;
}

function assertRelativeCwd(cwd: string, workspaceKey: string): void {
  if (isAbsolute(cwd)) {
    throw new Error(
      `Invalid cwd for workspace "${workspaceKey}". Expected a relative path, got absolute path.`,
    );
  }
}

function containsEscapeSegments(relativePath: string): boolean {
  return (
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('../')
  );
}

function assertWithinWorkspace(
  workspaceRoot: string,
  candidatePath: string,
  workspaceKey: string,
): string | undefined {
  const rel = relative(workspaceRoot, candidatePath);
  if (rel === '') return undefined;
  if (isAbsolute(rel) || containsEscapeSegments(rel)) {
    throw new Error(`Resolved cwd escapes workspace "${workspaceKey}".`);
  }
  return rel;
}

function toDisplayPath(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

async function assertExistingDirectory(pathValue: string, contextLabel: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(pathValue);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${contextLabel} does not exist: ${pathValue}`);
    }
    throw err;
  }
  if (!stats.isDirectory()) {
    throw new Error(`${contextLabel} is not a directory: ${pathValue}`);
  }
}

export async function resolveAgentWorkspace(
  workspaces: WorkerAgentCommandConfig['workspaces'],
  input: ResolveAgentWorkspaceInput,
  options: ResolveAgentWorkspaceOptions = {},
): Promise<ResolvedAgentWorkspace> {
  const workspace = workspaces[input.workspaceKey];
  if (!workspace) {
    throw new Error(`Unknown workspace key: ${input.workspaceKey}`);
  }

  const workspaceRoot = resolve(workspace.path);
  const normalizedCwd = normalizeOptionalCwd(input.cwd);
  if (normalizedCwd) {
    assertRelativeCwd(normalizedCwd, input.workspaceKey);
  }

  const resolvedCwd = normalizedCwd ? resolve(workspaceRoot, normalizedCwd) : workspaceRoot;
  const relativeCwd = assertWithinWorkspace(workspaceRoot, resolvedCwd, input.workspaceKey);

  const requireExists = options.requireExists ?? false;
  if (requireExists) {
    await assertExistingDirectory(workspaceRoot, `Workspace root for "${input.workspaceKey}"`);
    await assertExistingDirectory(resolvedCwd, `Resolved cwd for "${input.workspaceKey}"`);

    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const canonicalResolvedCwd = await realpath(resolvedCwd);
    assertWithinWorkspace(canonicalWorkspaceRoot, canonicalResolvedCwd, input.workspaceKey);
  }

  const displayCwd = relativeCwd ? toDisplayPath(relativeCwd) : undefined;
  const displayNameBase = workspace.label ?? input.workspaceKey;

  return {
    workspaceKey: input.workspaceKey,
    workspaceRoot,
    resolvedCwd,
    ...(relativeCwd ? { relativeCwd } : {}),
    ...(workspace.label ? { label: workspace.label } : {}),
    ...(workspace.description ? { description: workspace.description } : {}),
    display: {
      workspaceKey: input.workspaceKey,
      ...(workspace.label ? { label: workspace.label } : {}),
      ...(workspace.description ? { description: workspace.description } : {}),
      name: displayCwd ? `${displayNameBase} / ${displayCwd}` : displayNameBase,
      ...(displayCwd ? { cwd: displayCwd } : {}),
    },
  };
}
