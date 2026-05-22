import type {
  AgentSessionListFilters,
  AgentSessionListProvider,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  getAgentSessionListAdapter,
  type AgentSessionListAdapterInput,
  type AgentSessionListAdapterPageState,
  type AgentSessionListAdapterRegistry,
  type AgentSessionListAdapterResult,
} from './agentSessionListAdapters.js';
import type { InteractiveAgentProfile } from './interactiveAgentTypes.js';
import { resolveAgentWorkspace, type ResolvedAgentWorkspace } from './workspaceResolver.js';

type AgentSessionListEventPayload = CoreWorkerEvent<'agent.sessions.list'>['payload'];
type ListCapableInteractiveAgentProfile = InteractiveAgentProfile & {
  provider: AgentSessionListProvider;
};

type AggregateCursorScope = {
  workerId: string;
  pageSize: number;
  filters?: AgentSessionListFilters;
  profileKeys: string[];
};

type AggregateCursorPayload = {
  version: 1;
  mode: 'aggregate';
  previousCursor?: string;
  scope: AggregateCursorScope;
  profileStates: Record<string, AgentSessionListAdapterPageState>;
  bufferedSessions: AgentSessionSummary[];
};

type AggregateProfilePageResult = {
  sessions: AgentSessionSummary[];
  nextState?: AgentSessionListAdapterPageState;
  hasMore: boolean;
};

const AGGREGATE_CURSOR_PREFIX = 'sniptail-agent-sessions-v1.';

export type ListAgentSessionsForWorkerInput = {
  config: WorkerConfig;
  payload: AgentSessionListEventPayload;
  adapters?: AgentSessionListAdapterRegistry;
};

export type ListAgentSessionsForWorkerResult = {
  sessions: AgentSessionSummary[];
  previousCursor?: string;
  nextCursor?: string;
  errorMessage?: string;
};

function resolveAgentProfile(
  config: WorkerConfig,
  agentProfileKey: string,
): InteractiveAgentProfile | undefined {
  const profile = config.agent.profiles[agentProfileKey];
  return profile ? { key: agentProfileKey, ...profile } : undefined;
}

function toUserErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.';
}

function buildUnsupportedCodexMessage(): string {
  return 'Session listing is not supported for Codex profiles because the Codex SDK does not expose previous sessions.';
}

function buildUnsupportedProviderMessage(profile: InteractiveAgentProfile): string {
  return `Session listing is not supported for provider "${profile.provider}" on profile "${profile.key}".`;
}

function buildNoListCapableProfilesMessage(workerId: string): string {
  return `Worker \`${workerId}\` has no configured agent profiles that support session listing.`;
}

function buildInvalidAggregateCursorMessage(): string {
  return 'Session list cursor is invalid or expired. Refresh the session list.';
}

function isAggregateCursor(cursor: string): boolean {
  return cursor.startsWith(AGGREGATE_CURSOR_PREFIX);
}

function encodeAggregateCursor(payload: AggregateCursorPayload): string {
  return `${AGGREGATE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function decodeAggregateCursor(cursor: string): AggregateCursorPayload {
  if (!isAggregateCursor(cursor)) {
    throw new Error('cursor-prefix');
  }

  const encodedPayload = cursor.slice(AGGREGATE_CURSOR_PREFIX.length);
  if (!encodedPayload) {
    throw new Error('cursor-format');
  }

  const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<
    AggregateCursorPayload
  >;
  if (parsed.version !== 1 || parsed.mode !== 'aggregate') {
    throw new Error('cursor-version');
  }
  if (!parsed.scope || typeof parsed.scope !== 'object') {
    throw new Error('cursor-scope');
  }
  if (
    typeof parsed.scope.workerId !== 'string' ||
    typeof parsed.scope.pageSize !== 'number' ||
    !Array.isArray(parsed.scope.profileKeys)
  ) {
    throw new Error('cursor-scope');
  }
  if (!parsed.profileStates || typeof parsed.profileStates !== 'object') {
    throw new Error('cursor-profile-states');
  }
  if (!Array.isArray(parsed.bufferedSessions)) {
    throw new Error('cursor-buffered-sessions');
  }

  return {
    version: 1,
    mode: 'aggregate',
    scope: {
      workerId: parsed.scope.workerId,
      pageSize: parsed.scope.pageSize,
      ...(parsed.scope.filters ? { filters: parsed.scope.filters } : {}),
      profileKeys: [...parsed.scope.profileKeys],
    },
    ...(typeof parsed.previousCursor === 'string' ? { previousCursor: parsed.previousCursor } : {}),
    profileStates: parsed.profileStates,
    bufferedSessions: parsed.bufferedSessions,
  };
}

function isListCapableProvider(
  provider: InteractiveAgentProfile['provider'],
): provider is AgentSessionListProvider {
  return provider === 'acp' || provider === 'opencode' || provider === 'copilot';
}

function isListCapableProfile(
  profile: InteractiveAgentProfile,
): profile is ListCapableInteractiveAgentProfile {
  return isListCapableProvider(profile.provider);
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

  const profileCompare = left.agentProfileKey.localeCompare(right.agentProfileKey);
  if (profileCompare !== 0) {
    return profileCompare;
  }

  return left.id.localeCompare(right.id);
}

async function resolveWorkspaceFilter(
  config: WorkerConfig,
  payload: AgentSessionListEventPayload,
): Promise<ResolvedAgentWorkspace | undefined> {
  const workspaceKey = payload.filters?.workspaceKey;
  const cwd = payload.filters?.cwd;

  if (!workspaceKey && !cwd) {
    return undefined;
  }
  if (!workspaceKey && cwd) {
    throw new Error('A workspace key is required when cwd is provided.');
  }

  return resolveAgentWorkspace(
    config.agent.workspaces,
    {
      workspaceKey: workspaceKey as string,
      ...(cwd ? { cwd } : {}),
    },
    { requireExists: false },
  );
}

function normalizeAdapterSessions(
  result: AgentSessionListAdapterResult,
  profile: InteractiveAgentProfile,
): AgentSessionSummary[] {
  return result.sessions.map((session) => ({
    ...session,
    provider: profile.provider === 'codex' ? session.provider : profile.provider,
    agentProfileKey: profile.key,
  }));
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRoots(roots: string[] | undefined): string[] | undefined {
  if (!roots?.length) {
    return undefined;
  }

  const normalized = [...new Set(roots.map((root) => root.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  return normalized.length ? normalized : undefined;
}

function normalizeFiltersForScope(
  filters: AgentSessionListFilters | undefined,
  resolvedWorkspace: ResolvedAgentWorkspace | undefined,
): AgentSessionListFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const roots = normalizeRoots(filters.roots);
  const normalized: AgentSessionListFilters = {};
  if (resolvedWorkspace?.workspaceKey) {
    normalized.workspaceKey = resolvedWorkspace.workspaceKey;
  }
  if (resolvedWorkspace?.display.cwd) {
    normalized.cwd = resolvedWorkspace.display.cwd;
  }
  const gitRoot = normalizeOptionalString(filters.gitRoot);
  if (gitRoot) {
    normalized.gitRoot = gitRoot;
  }
  const repository = normalizeOptionalString(filters.repository);
  if (repository) {
    normalized.repository = repository;
  }
  const branch = normalizeOptionalString(filters.branch);
  if (branch) {
    normalized.branch = branch;
  }
  if (roots) {
    normalized.roots = roots;
  }
  const search = normalizeOptionalString(filters.search);
  if (search) {
    normalized.search = search;
  }
  const start = normalizeOptionalString(filters.start);
  if (start) {
    normalized.start = start;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function buildAggregateCursorScope(
  payload: AgentSessionListEventPayload,
  profiles: ListCapableInteractiveAgentProfile[],
  resolvedWorkspace: ResolvedAgentWorkspace | undefined,
): AggregateCursorScope {
  const normalizedFilters = normalizeFiltersForScope(payload.filters, resolvedWorkspace);
  return {
    workerId: payload.workerId,
    pageSize: payload.pageSize,
    ...(normalizedFilters ? { filters: normalizedFilters } : {}),
    profileKeys: profiles.map((profile) => profile.key),
  };
}

function scopesMatch(left: AggregateCursorScope, right: AggregateCursorScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildAggregateAdapterInput(input: {
  config: WorkerConfig;
  profile: ListCapableInteractiveAgentProfile;
  payload: AgentSessionListEventPayload;
  resolvedWorkspace?: ResolvedAgentWorkspace;
  cursorState?: AgentSessionListAdapterPageState;
}): AgentSessionListAdapterInput {
  return {
    config: input.config,
    profile: input.profile,
    pageSize: input.payload.pageSize,
    ...(input.payload.filters ? { filters: input.payload.filters } : {}),
    ...(input.resolvedWorkspace ? { resolvedWorkspace: input.resolvedWorkspace } : {}),
    ...(input.cursorState ? { cursorState: input.cursorState } : {}),
  };
}

function buildCurrentPageAggregateCursor(input: {
  scope: AggregateCursorScope;
  profileStates?: Record<string, AgentSessionListAdapterPageState>;
  bufferedSessions?: AgentSessionSummary[];
}, previousCursor?: string): string {
  return encodeAggregateCursor({
    version: 1,
    mode: 'aggregate',
    scope: input.scope,
    ...(previousCursor ? { previousCursor } : {}),
    profileStates: input.profileStates ?? {},
    bufferedSessions: input.bufferedSessions ?? [],
  });
}

function resolveAggregateNextState(
  result: AgentSessionListAdapterResult,
  currentState: AgentSessionListAdapterPageState | undefined,
): AggregateProfilePageResult {
  const hasMore = result.hasMore ?? Boolean(result.nextCursor);
  const nextState =
    result.cursorState ??
    (result.nextCursor
      ? {
          ...(currentState?.offset !== undefined ? { offset: currentState.offset } : {}),
          cursor: result.nextCursor,
        }
      : undefined);

  return {
    sessions: result.sessions,
    ...(nextState ? { nextState } : {}),
    hasMore,
  };
}

async function listForExplicitProfile(input: {
  config: WorkerConfig;
  profile: InteractiveAgentProfile;
  payload: AgentSessionListEventPayload;
  resolvedWorkspace?: ResolvedAgentWorkspace;
  adapters?: AgentSessionListAdapterRegistry;
}): Promise<ListAgentSessionsForWorkerResult> {
  if (input.profile.provider === 'codex') {
    return {
      sessions: [],
      errorMessage: buildUnsupportedCodexMessage(),
    };
  }

  const adapter = getAgentSessionListAdapter(input.profile.provider, input.adapters);
  if (!adapter) {
    return {
      sessions: [],
      errorMessage: buildUnsupportedProviderMessage(input.profile),
    };
  }

  try {
    const result = await adapter.listSessions({
      config: input.config,
      profile: input.profile,
      pageSize: input.payload.pageSize,
      ...(input.payload.cursor ? { cursor: input.payload.cursor } : {}),
      ...(input.payload.filters ? { filters: input.payload.filters } : {}),
      ...(input.resolvedWorkspace ? { resolvedWorkspace: input.resolvedWorkspace } : {}),
    });
    return {
      sessions: normalizeAdapterSessions(result, input.profile),
      ...(result.previousCursor ? { previousCursor: result.previousCursor } : {}),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  } catch (err) {
    return {
      sessions: [],
      errorMessage: `Failed to list sessions for profile "${input.profile.key}": ${toUserErrorMessage(
        err,
      )}`,
    };
  }
}

export async function listAgentSessionsForWorker({
  config,
  payload,
  adapters,
}: ListAgentSessionsForWorkerInput): Promise<ListAgentSessionsForWorkerResult> {
  let resolvedWorkspace: ResolvedAgentWorkspace | undefined;
  try {
    resolvedWorkspace = await resolveWorkspaceFilter(config, payload);
  } catch (err) {
    return {
      sessions: [],
      errorMessage: toUserErrorMessage(err),
    };
  }

  if (payload.agentProfileKey) {
    const profile = resolveAgentProfile(config, payload.agentProfileKey);
    if (!profile) {
      return {
        sessions: [],
        errorMessage: `Unknown agent profile key: ${payload.agentProfileKey}`,
      };
    }

    return listForExplicitProfile({
      config,
      profile,
      payload,
      ...(resolvedWorkspace ? { resolvedWorkspace } : {}),
      ...(adapters ? { adapters } : {}),
    });
  }

  const listCapableProfiles = Object.keys(config.agent.profiles)
    .sort((left, right) => left.localeCompare(right))
    .map((profileKey) => resolveAgentProfile(config, profileKey))
    .filter((profile): profile is InteractiveAgentProfile => Boolean(profile))
    .filter(isListCapableProfile)
    .filter((profile) => Boolean(getAgentSessionListAdapter(profile.provider, adapters)));

  if (!listCapableProfiles.length) {
    return {
      sessions: [],
      errorMessage: buildNoListCapableProfilesMessage(config.workerId),
    };
  }

  const scope = buildAggregateCursorScope(payload, listCapableProfiles, resolvedWorkspace);
  let decodedCursor: AggregateCursorPayload | undefined;
  if (payload.cursor) {
    try {
      decodedCursor = decodeAggregateCursor(payload.cursor);
    } catch {
      return {
        sessions: [],
        errorMessage: buildInvalidAggregateCursorMessage(),
      };
    }

    if (!scopesMatch(decodedCursor.scope, scope)) {
      return {
        sessions: [],
        errorMessage: buildInvalidAggregateCursorMessage(),
      };
    }
  }

  const currentPageCursor = decodedCursor
    ? payload.cursor
    : buildCurrentPageAggregateCursor({
      scope,
    });

  const sessions: AgentSessionSummary[] = decodedCursor?.bufferedSessions
    ? [...decodedCursor.bufferedSessions]
    : [];
  const nextProfileStates: Record<string, AgentSessionListAdapterPageState> = {
    ...(decodedCursor?.profileStates ?? {}),
  };
  let hasMore = Object.keys(nextProfileStates).length > 0;

  const shouldQueryAdapters = !decodedCursor || sessions.length < payload.pageSize;
  for (const profile of shouldQueryAdapters ? listCapableProfiles : []) {
    const cursorState = decodedCursor?.profileStates[profile.key];
    if (decodedCursor && !cursorState) {
      continue;
    }

    const adapter = getAgentSessionListAdapter(profile.provider, adapters);
    if (!adapter) {
      continue;
    }

    try {
      const result = await adapter.listSessions(
        buildAggregateAdapterInput({
          config,
          profile,
          payload,
          ...(resolvedWorkspace ? { resolvedWorkspace } : {}),
          ...(cursorState ? { cursorState } : {}),
        }),
      );
      const aggregateResult = resolveAggregateNextState(result, cursorState);

      sessions.push(...normalizeAdapterSessions({ sessions: aggregateResult.sessions }, profile));

      if (aggregateResult.nextState) {
        nextProfileStates[profile.key] = aggregateResult.nextState;
      } else {
        delete nextProfileStates[profile.key];
      }
      hasMore = Object.keys(nextProfileStates).length > 0;
    } catch (err) {
      return {
        sessions: [],
        errorMessage: `Failed to list sessions for profile "${profile.key}": ${toUserErrorMessage(
          err,
        )}`,
      };
    }
  }

  sessions.sort(compareSessionSummary);

  const pageSessions = sessions.slice(0, payload.pageSize);
  const bufferedSessions = sessions.slice(payload.pageSize);
  const nextCursorNeeded = bufferedSessions.length > 0 || hasMore;

  return {
    sessions: pageSessions,
    ...(decodedCursor?.previousCursor ? { previousCursor: decodedCursor.previousCursor } : {}),
    ...(nextCursorNeeded
      ? {
          nextCursor: buildCurrentPageAggregateCursor(
            {
              scope,
              profileStates: nextProfileStates,
              bufferedSessions,
            },
            currentPageCursor,
          ),
        }
      : {}),
  };
}
