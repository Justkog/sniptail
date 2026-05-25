import { isAbsolute } from 'node:path';
import type {
  AgentSessionListFilters,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type {
  AgentCommandMetadata,
  AgentCommandProfileMetadata,
} from '../agentCommandMetadataCache.js';

export const SLACK_AGENT_SESSIONS_PAGE_SIZE = 5;

type LiveWorker = AgentCommandMetadata['aggregated']['liveWorkers'][number];

type ParsedAgentSessionsCommand = {
  workerId: string;
  agentProfileKey?: string;
  filters?: AgentSessionListFilters;
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function validateRelativeCwd(cwd: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(cwd);
  if (!normalized) {
    return undefined;
  }
  if (isAbsolute(normalized)) {
    throw new Error('`cwd` must be a relative path.');
  }
  return normalized;
}

export function normalizeAgentSessionListFilters(
  filters: AgentSessionListFilters | undefined,
): AgentSessionListFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const normalized: AgentSessionListFilters = {};
  const assignTrimmed = (
    key: keyof Omit<AgentSessionListFilters, 'roots'>,
    value: string | undefined,
  ) => {
    const trimmed = normalizeOptionalString(value);
    if (trimmed) {
      normalized[key] = trimmed;
    }
  };

  assignTrimmed('workspaceKey', filters.workspaceKey);
  assignTrimmed('cwd', filters.cwd);
  assignTrimmed('gitRoot', filters.gitRoot);
  assignTrimmed('repository', filters.repository);
  assignTrimmed('branch', filters.branch);
  assignTrimmed('search', filters.search);
  assignTrimmed('start', filters.start);

  const roots = filters.roots
    ?.map((root) => normalizeOptionalString(root))
    .filter((root): root is string => Boolean(root));
  if (roots?.length) {
    normalized.roots = [...new Set(roots)].sort((left, right) => left.localeCompare(right));
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function agentSessionListFiltersEqual(
  left: AgentSessionListFilters | undefined,
  right: AgentSessionListFilters | undefined,
): boolean {
  const normalizedLeft = normalizeAgentSessionListFilters(left);
  const normalizedRight = normalizeAgentSessionListFilters(right);
  return JSON.stringify(normalizedLeft ?? {}) === JSON.stringify(normalizedRight ?? {});
}

export function buildAgentSessionsCommandUsage(commandName: string): string {
  return `Usage: ${commandName} worker:<worker-id> [agent_profile:<profile-key>] [workspace:<workspace-key>] [cwd:<relative-path>]`;
}

export function parseAgentSessionsCommandText(text: string): ParsedAgentSessionsCommand {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const raw: {
    worker?: string;
    agentProfileKey?: string;
    workspaceKey?: string;
    cwd?: string;
  } = {};

  for (const token of tokens) {
    const separatorIndex = token.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      throw new Error(`Invalid selector: \`${token}\`.`);
    }
    const key = token.slice(0, separatorIndex).trim();
    const value = token.slice(separatorIndex + 1).trim();
    if (!value) {
      throw new Error(`Invalid selector: \`${token}\`.`);
    }

    switch (key) {
      case 'worker':
        raw.worker = value;
        break;
      case 'agent_profile':
        raw.agentProfileKey = value;
        break;
      case 'workspace':
        raw.workspaceKey = value;
        break;
      case 'cwd':
        raw.cwd = value;
        break;
      default:
        throw new Error(`Unknown selector: \`${key}\`.`);
    }
  }

  const workerId = normalizeOptionalString(raw.worker);
  if (!workerId) {
    throw new Error('A worker selector is required.');
  }

  const workspaceKey = normalizeOptionalString(raw.workspaceKey);
  const cwd = validateRelativeCwd(raw.cwd);
  if (!workspaceKey && cwd) {
    throw new Error('A workspace selector is required when cwd is provided.');
  }

  const filters: AgentSessionListFilters = {};
  if (workspaceKey) {
    filters.workspaceKey = workspaceKey;
  }
  if (cwd) {
    filters.cwd = cwd;
  }

  const parsedCommand: ParsedAgentSessionsCommand = { workerId };
  const agentProfileKey = normalizeOptionalString(raw.agentProfileKey);
  const normalizedFilters = normalizeAgentSessionListFilters(filters);
  if (agentProfileKey) {
    parsedCommand.agentProfileKey = agentProfileKey;
  }
  if (normalizedFilters) {
    parsedCommand.filters = normalizedFilters;
  }

  return parsedCommand;
}

export function findLiveWorker(
  metadata: AgentCommandMetadata,
  workerId: string,
): LiveWorker | undefined {
  return metadata.aggregated.liveWorkers.find((worker) => worker.workerId === workerId);
}

export function findWorkerProfile(
  worker: LiveWorker,
  profileKey: string,
): AgentCommandProfileMetadata | undefined {
  const profile = worker.profiles.find((candidate) => candidate.key === profileKey);
  return profile
    ? {
        key: profile.key,
        status: 'available',
        provider: profile.provider,
        ...(profile.agent ? { agent: profile.agent } : {}),
        ...(profile.profile ? { profile: profile.profile } : {}),
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
        ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
        ...(profile.label ? { label: profile.label } : {}),
        ...(profile.description ? { description: profile.description } : {}),
        workerIds: [worker.workerId],
      }
    : undefined;
}

export function workerHasWorkspace(worker: LiveWorker, workspaceKey: string): boolean {
  return worker.workspaces.some((workspace) => workspace.key === workspaceKey);
}

export function validateSlackAgentSessionsSelection(input: {
  metadata: AgentCommandMetadata;
  workerId: string;
  agentProfileKey?: string;
  filters?: AgentSessionListFilters;
}): { worker: LiveWorker } {
  const worker = findLiveWorker(input.metadata, input.workerId);
  if (!worker) {
    throw new Error(
      `Worker \`${input.workerId}\` is not live. Refresh the worker list and try again.`,
    );
  }

  if (input.agentProfileKey && !findWorkerProfile(worker, input.agentProfileKey)) {
    throw new Error(
      `Worker \`${input.workerId}\` does not expose agent profile \`${input.agentProfileKey}\`.`,
    );
  }

  const workspaceKey = input.filters?.workspaceKey?.trim();
  if (workspaceKey && !workerHasWorkspace(worker, workspaceKey)) {
    throw new Error(`Worker \`${input.workerId}\` does not expose workspace \`${workspaceKey}\`.`);
  }

  return { worker };
}

export function buildAgentSessionsListWorkerEvent(input: {
  requestId: string;
  channelId: string;
  userId: string;
  workspaceId?: string;
  sourceThreadId?: string;
  workerId: string;
  agentProfileKey?: string;
  pageSize?: number;
  cursor?: string;
  filters?: AgentSessionListFilters;
}): CoreWorkerEvent<'agent.sessions.list'> {
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    type: 'agent.sessions.list',
    payload: {
      response: {
        provider: 'slack',
        channelId: input.channelId,
        userId: input.userId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.sourceThreadId ? { threadId: input.sourceThreadId } : {}),
      },
      workerId: input.workerId,
      pageSize: input.pageSize ?? SLACK_AGENT_SESSIONS_PAGE_SIZE,
      ...(input.agentProfileKey ? { agentProfileKey: input.agentProfileKey } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
    },
  };
}

export function formatSlackAgentSessionTimestamp(session: AgentSessionSummary): string | undefined {
  return session.updatedAt
    ? `Updated: ${session.updatedAt}`
    : session.createdAt
      ? `Created: ${session.createdAt}`
      : undefined;
}
