import { isAbsolute, relative, resolve, sep } from 'node:path';
import { launchAcpRuntime } from '@sniptail/core/acp/acpRuntime.js';
import type { AgentSessionSummary } from '@sniptail/core/agent-sessions/listing.js';
import type {
  AgentSessionListAdapter,
  AgentSessionListAdapterInput,
  AgentSessionListAdapterResult,
} from '../agent-command/agentSessionListAdapters.js';

function containsEscapeSegments(relativePath: string): boolean {
  return (
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('../')
  );
}

function isWithinWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const candidateRelativePath = relative(workspaceRoot, candidatePath);
  return candidateRelativePath === ''
    ? true
    : !isAbsolute(candidateRelativePath) && !containsEscapeSegments(candidateRelativePath);
}

function toDisplayPath(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

type ResolvedSessionWorkspace = {
  workspaceKey: string;
  workspaceRoot: string;
};

function normalizeRelativePath(pathValue: string): string | undefined {
  const normalized = toDisplayPath(pathValue);
  return normalized ? normalized : undefined;
}

function inferSessionWorkspace(
  sessionPath: string,
  input: AgentSessionListAdapterInput,
): ResolvedSessionWorkspace | undefined {
  const resolvedWorkspace = input.resolvedWorkspace;
  if (resolvedWorkspace && isWithinWorkspace(resolvedWorkspace.workspaceRoot, sessionPath)) {
    return {
      workspaceKey: resolvedWorkspace.workspaceKey,
      workspaceRoot: resolvedWorkspace.workspaceRoot,
    };
  }

  const matches = Object.keys(input.config.agent.workspaces)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((workspaceKey) => {
      const workspace = input.config.agent.workspaces[workspaceKey];
      return workspace
        ? [
            {
              workspaceKey,
              workspaceRoot: resolve(workspace.path),
            },
          ]
        : [];
    })
    .filter((workspace) => isWithinWorkspace(workspace.workspaceRoot, sessionPath));

  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeSessionRoots(
  additionalDirectories: string[] | null | undefined,
  workspace: ResolvedSessionWorkspace | undefined,
): string[] | undefined {
  if (!additionalDirectories?.length || !workspace) {
    return undefined;
  }

  const roots: string[] = [];
  for (const directory of additionalDirectories) {
    if (!isWithinWorkspace(workspace.workspaceRoot, directory)) {
      continue;
    }

    const relativeDirectory = relative(workspace.workspaceRoot, directory);
    const normalizedDirectory = normalizeRelativePath(relativeDirectory);
    if (normalizedDirectory && !roots.includes(normalizedDirectory)) {
      roots.push(normalizedDirectory);
    }
  }

  return roots.length ? roots : undefined;
}

function resolveAdditionalDirectories(input: AgentSessionListAdapterInput): string[] | undefined {
  if (!input.filters?.roots?.length) {
    return undefined;
  }
  if (!input.resolvedWorkspace) {
    throw new Error('A workspace key is required when roots are provided for ACP session listing.');
  }

  const directories: string[] = [];
  for (const root of input.filters.roots) {
    const normalizedRoot = root.trim();
    if (!normalizedRoot) {
      continue;
    }
    if (isAbsolute(normalizedRoot)) {
      throw new Error('Invalid roots filter. Expected relative paths inside the selected workspace.');
    }

    const absoluteRoot = resolve(input.resolvedWorkspace.workspaceRoot, normalizedRoot);
    if (!isWithinWorkspace(input.resolvedWorkspace.workspaceRoot, absoluteRoot)) {
      throw new Error('Resolved roots filter escapes the selected workspace.');
    }
    if (!directories.includes(absoluteRoot)) {
      directories.push(absoluteRoot);
    }
  }

  return directories.length ? directories : undefined;
}

function normalizeSession(
  session: {
    sessionId: string;
    cwd: string;
    additionalDirectories?: string[] | null;
    title?: string | null;
    updatedAt?: string | null;
  },
  input: AgentSessionListAdapterInput,
): AgentSessionSummary {
  const title = normalizeOptionalString(session.title);
  const updatedAt = normalizeOptionalString(session.updatedAt);
  const workspace = inferSessionWorkspace(session.cwd, input);
  const roots = normalizeSessionRoots(session.additionalDirectories, workspace);
  const summary: AgentSessionSummary = {
    id: session.sessionId,
    provider: 'acp',
    agentProfileKey: input.profile.key,
    ...(title ? { title } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(roots ? { roots } : {}),
  };

  if (!workspace) {
    return summary;
  }

  const relativeCwd = normalizeRelativePath(relative(workspace.workspaceRoot, session.cwd));
  return {
    ...summary,
    workspaceKey: workspace.workspaceKey,
    ...(relativeCwd ? { cwd: relativeCwd } : {}),
  };
}

export const acpAgentSessionListAdapter: AgentSessionListAdapter = {
  provider: 'acp',
  async listSessions(input): Promise<AgentSessionListAdapterResult> {
    if (input.profile.provider !== 'acp') {
      throw new Error(`Invalid ACP session list profile provider: ${input.profile.provider}`);
    }

    const additionalDirectories = resolveAdditionalDirectories(input);
    const cursor = input.cursorState?.cursor ?? input.cursor;
    const runtime = await launchAcpRuntime({
      launch: input.profile,
      cwd: input.resolvedWorkspace?.resolvedCwd ?? input.config.repoCacheRoot,
      diagnostics: {
        configSource: `agent.profiles.${input.profile.key}`,
      },
    });

    try {
      const result = await runtime.listSessions({
        ...(cursor ? { cursor } : {}),
        ...(input.resolvedWorkspace ? { cwd: input.resolvedWorkspace.resolvedCwd } : {}),
        ...(additionalDirectories ? { additionalDirectories } : {}),
      });
      const nextCursor = normalizeOptionalString(result.nextCursor ?? undefined);
      return {
        sessions: result.sessions.map((session) => normalizeSession(session, input)),
        ...(nextCursor ? { nextCursor } : {}),
        ...(nextCursor ? { cursorState: { cursor: nextCursor } } : {}),
        hasMore: Boolean(nextCursor),
      };
    } finally {
      await runtime.close();
    }
  },
};
