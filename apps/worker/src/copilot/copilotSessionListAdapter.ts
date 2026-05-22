import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { AgentSessionSummary } from '@sniptail/core/agent-sessions/listing.js';
import {
  listCopilotSessions,
  type ListedCopilotSession,
} from '@sniptail/core/copilot/copilotSessionListing.js';
import type {
  AgentSessionListAdapter,
  AgentSessionListAdapterInput,
  AgentSessionListAdapterResult,
} from '../agent-command/agentSessionListAdapters.js';

const COPILOT_CURSOR_PREFIX = 'sniptail-copilot-sessions-v1.';
const INVALID_COPILOT_CURSOR_MESSAGE =
  'Copilot session list cursor is invalid or expired. Refresh the session list.';

type CopilotCursorPayload = {
  version: 1;
  mode: 'copilot';
  offset: number;
  scope: CopilotCursorScope;
};

type CopilotCursorScope = {
  workerId: string;
  agentProfileKey: string;
  pageSize: number;
  filters?: CopilotCursorFilters;
};

type CopilotCursorFilters = {
  workspaceKey?: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
};

type ResolvedSessionWorkspace = {
  workspaceKey: string;
  workspaceRoot: string;
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

function normalizeRelativePath(pathValue: string): string | undefined {
  const normalized = toDisplayPath(pathValue);
  return normalized ? normalized : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeFiltersForScope(input: AgentSessionListAdapterInput): CopilotCursorFilters | undefined {
  const filters: CopilotCursorFilters = {};
  if (input.resolvedWorkspace?.workspaceKey) {
    filters.workspaceKey = input.resolvedWorkspace.workspaceKey;
  }
  if (input.resolvedWorkspace?.display.cwd) {
    filters.cwd = input.resolvedWorkspace.display.cwd;
  }

  const gitRoot = normalizeOptionalString(input.filters?.gitRoot);
  if (gitRoot) {
    filters.gitRoot = gitRoot;
  }

  const repository = normalizeOptionalString(input.filters?.repository);
  if (repository) {
    filters.repository = repository;
  }

  const branch = normalizeOptionalString(input.filters?.branch);
  if (branch) {
    filters.branch = branch;
  }

  return Object.keys(filters).length ? filters : undefined;
}

function buildCursorScope(input: AgentSessionListAdapterInput): CopilotCursorScope {
  const filters = normalizeFiltersForScope(input);
  return {
    workerId: input.config.workerId,
    agentProfileKey: input.profile.key,
    pageSize: input.pageSize,
    ...(filters ? { filters } : {}),
  };
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

function encodeCursor(offset: number, scope: CopilotCursorScope): string {
  return `${COPILOT_CURSOR_PREFIX}${Buffer.from(
    JSON.stringify({
      version: 1,
      mode: 'copilot',
      offset,
      scope,
    } satisfies CopilotCursorPayload),
    'utf8',
  ).toString('base64url')}`;
}

function scopesMatch(left: CopilotCursorScope, right: CopilotCursorScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decodeCursor(cursor: string, scope: CopilotCursorScope): number {
  if (!cursor.startsWith(COPILOT_CURSOR_PREFIX)) {
    throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
  }

  const encodedPayload = cursor.slice(COPILOT_CURSOR_PREFIX.length);
  if (!encodedPayload) {
    throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<
      CopilotCursorPayload
    >;
    if (payload.version !== 1 || payload.mode !== 'copilot') {
      throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
    }
    if (!Number.isInteger(payload.offset) || (payload.offset as number) < 0) {
      throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
    }
    if (!payload.scope || !scopesMatch(payload.scope as CopilotCursorScope, scope)) {
      throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
    }
    return payload.offset as number;
  } catch {
    throw new Error(INVALID_COPILOT_CURSOR_MESSAGE);
  }
}

function resolvePageOffset(input: AgentSessionListAdapterInput, scope: CopilotCursorScope): number {
  if (input.cursorState?.offset !== undefined) {
    return input.cursorState.offset;
  }
  if (!input.cursor) {
    return 0;
  }
  return decodeCursor(input.cursor, scope);
}

function buildListFilter(input: AgentSessionListAdapterInput) {
  const gitRoot = normalizeOptionalString(input.filters?.gitRoot);
  const repository = normalizeOptionalString(input.filters?.repository);
  const branch = normalizeOptionalString(input.filters?.branch);

  return {
    ...(input.resolvedWorkspace ? { cwd: input.resolvedWorkspace.resolvedCwd } : {}),
    ...(gitRoot ? { gitRoot } : {}),
    ...(repository ? { repository } : {}),
    ...(branch ? { branch } : {}),
  };
}

function normalizeSession(
  session: ListedCopilotSession,
  input: AgentSessionListAdapterInput,
): AgentSessionSummary {
  const title = normalizeOptionalString(session.summary);
  const createdAt = session.startTime.toISOString();
  const updatedAt = session.modifiedTime.toISOString();
  const project = normalizeOptionalString(session.context?.repository);
  const branch = normalizeOptionalString(session.context?.branch);
  const summary: AgentSessionSummary = {
    id: session.sessionId,
    provider: 'copilot',
    agentProfileKey: input.profile.key,
    ...(title ? { title } : {}),
    createdAt,
    updatedAt,
    ...(project ? { project } : {}),
    ...(branch ? { description: `Branch: ${branch}` } : {}),
  };

  const cwd = normalizeOptionalString(session.context?.cwd);
  if (!cwd) {
    return summary;
  }

  const workspace = inferSessionWorkspace(cwd, input);
  if (!workspace) {
    return summary;
  }

  const relativeCwd = normalizeRelativePath(relative(workspace.workspaceRoot, cwd));
  return {
    ...summary,
    workspaceKey: workspace.workspaceKey,
    ...(relativeCwd ? { cwd: relativeCwd } : {}),
  };
}

export const copilotAgentSessionListAdapter: AgentSessionListAdapter = {
  provider: 'copilot',
  async listSessions(input): Promise<AgentSessionListAdapterResult> {
    if (input.profile.provider !== 'copilot') {
      throw new Error(`Invalid Copilot session list profile provider: ${input.profile.provider}`);
    }

    const scope = buildCursorScope(input);
    const offset = resolvePageOffset(input, scope);
    const sessions = await listCopilotSessions({
      workDir: input.resolvedWorkspace?.resolvedCwd ?? input.config.repoCacheRoot,
      env: process.env,
      executionMode: input.config.copilot.executionMode,
      filter: buildListFilter(input),
      ...(input.config.copilot.executionMode === 'docker'
        ? {
            docker: {
              ...(input.config.copilot.dockerfilePath
                ? { dockerfilePath: input.config.copilot.dockerfilePath }
                : {}),
              ...(input.config.copilot.dockerImage
                ? { image: input.config.copilot.dockerImage }
                : {}),
              ...(input.config.copilot.dockerBuildContext
                ? { buildContext: input.config.copilot.dockerBuildContext }
                : {}),
            },
          }
        : {}),
    });

    const normalizedSessions = sessions
      .map((session) => normalizeSession(session, input))
      .sort(compareSessionSummary);
    const pageSessions = normalizedSessions.slice(offset, offset + input.pageSize);
    const nextOffset = offset + pageSessions.length;
    const hasMore = nextOffset < normalizedSessions.length;

    return {
      sessions: pageSessions,
      ...(hasMore ? { nextCursor: encodeCursor(nextOffset, scope) } : {}),
      ...(hasMore ? { cursorState: { offset: nextOffset } } : {}),
      hasMore,
    };
  },
};
