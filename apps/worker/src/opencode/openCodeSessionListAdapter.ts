import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AgentSessionSummary } from '@sniptail/core/agent-sessions/listing.js';
import type {
  AgentSessionListAdapter,
  AgentSessionListAdapterInput,
  AgentSessionListAdapterResult,
} from '../agent-command/agentSessionListAdapters.js';
import { createOpenCodeWorkerRuntime } from './openCodeWorkerRuntime.js';

type OpenCodeSession = {
  id: string;
  directory: string;
  title?: string;
  project?: {
    name?: string;
  } | null;
  time: {
    created: number;
    updated: number;
  };
};

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

function normalizeOptionalString(value: string | undefined | null): string | undefined {
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

function toIsoString(timestampMs: number | undefined): string | undefined {
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs as number).toISOString();
}

function parseOpenCodeCursor(value: string | undefined): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  throw new Error('Invalid start filter. Expected an ISO timestamp or milliseconds since epoch.');
}

function compareTimestampDesc(left: string | undefined, right: string | undefined): number {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftMs);
  const rightValid = Number.isFinite(rightMs);
  if (leftValid && rightValid && leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }
  return 0;
}

function compareSessionSummary(left: AgentSessionSummary, right: AgentSessionSummary): number {
  const updatedCompare = compareTimestampDesc(left.updatedAt, right.updatedAt);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }

  const createdCompare = compareTimestampDesc(left.createdAt, right.createdAt);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return left.id.localeCompare(right.id);
}

function normalizeSession(
  session: OpenCodeSession,
  input: AgentSessionListAdapterInput,
): AgentSessionSummary {
  const title = normalizeOptionalString(session.title);
  const workspace = inferSessionWorkspace(session.directory, input);
  const createdAt = toIsoString(session.time.created);
  const updatedAt = toIsoString(session.time.updated);
  const project = normalizeOptionalString(session.project?.name);
  const summary: AgentSessionSummary = {
    id: session.id,
    provider: 'opencode',
    agentProfileKey: input.profile.key,
    ...(title ? { title } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(project ? { project } : {}),
  };

  if (!workspace) {
    return summary;
  }

  const relativeCwd = normalizeRelativePath(relative(workspace.workspaceRoot, session.directory));
  return {
    ...summary,
    workspaceKey: workspace.workspaceKey,
    ...(relativeCwd ? { cwd: relativeCwd } : {}),
  };
}

function buildListQuery(input: AgentSessionListAdapterInput): {
  directory?: string;
  search?: string;
  start?: number;
  cursor?: number;
  limit: number;
} {
  const start = parseOpenCodeCursor(input.filters?.start);
  const cursor = parseOpenCodeCursor(input.cursorState?.cursor ?? input.cursor);
  const search = normalizeOptionalString(input.filters?.search);

  return {
    ...(input.resolvedWorkspace ? { directory: input.resolvedWorkspace.resolvedCwd } : {}),
    ...(search ? { search } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    limit: input.pageSize + 1,
  };
}

function buildNextCursor(sessions: AgentSessionSummary[], pageSize: number): string | undefined {
  const boundarySession = sessions.slice(0, pageSize).at(-1);
  const boundaryUpdatedAt = boundarySession?.updatedAt;
  if (!boundaryUpdatedAt) {
    return undefined;
  }

  const boundaryUpdatedMs = Date.parse(boundaryUpdatedAt);
  return Number.isFinite(boundaryUpdatedMs) ? String(boundaryUpdatedMs) : undefined;
}

export const openCodeAgentSessionListAdapter: AgentSessionListAdapter = {
  provider: 'opencode',
  async listSessions(input): Promise<AgentSessionListAdapterResult> {
    if (input.profile.provider !== 'opencode') {
      throw new Error(`Invalid OpenCode session list profile provider: ${input.profile.provider}`);
    }

    const workDir = input.resolvedWorkspace?.resolvedCwd ?? input.config.repoCacheRoot;
    const runtime = await createOpenCodeWorkerRuntime(
      `agent-session-list-${input.profile.key}`,
      workDir,
      input.config,
      input.profile,
    );

    try {
      const response = await runtime.client.session.list(buildListQuery(input));
      if (response.error) {
        throw new Error(`OpenCode session list failed: ${JSON.stringify(response.error)}`);
      }

      const normalizedSessions = (response.data ?? [])
        .map((session) => normalizeSession(session, input))
        .sort(compareSessionSummary);
      const hasMore = normalizedSessions.length > input.pageSize;
      const sessions = normalizedSessions.slice(0, input.pageSize);
      const nextCursor = hasMore ? buildNextCursor(normalizedSessions, input.pageSize) : undefined;

      return {
        sessions,
        ...(nextCursor ? { nextCursor } : {}),
        ...(nextCursor ? { cursorState: { cursor: nextCursor } } : {}),
        hasMore,
      };
    } finally {
      await runtime.close();
    }
  },
};
