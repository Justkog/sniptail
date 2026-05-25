import type {
  AgentSessionListFilters,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  agentSessionBrowserFiltersEqual,
  findAgentSessionBrowserWorkerProfile,
  normalizeAgentSessionBrowserFilters,
  validateAgentSessionBrowserCwd,
  validateAgentSessionBrowserSelection,
} from '../agentSessionBrowserShared.js';

export const SLACK_AGENT_SESSIONS_PAGE_SIZE = 5;

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
  return validateAgentSessionBrowserCwd(cwd);
}

export const agentSessionListFiltersEqual = agentSessionBrowserFiltersEqual;

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
  const normalizedFilters = normalizeAgentSessionBrowserFilters(filters);
  if (agentProfileKey) {
    parsedCommand.agentProfileKey = agentProfileKey;
  }
  if (normalizedFilters) {
    parsedCommand.filters = normalizedFilters;
  }

  return parsedCommand;
}

export const validateSlackAgentSessionsSelection = validateAgentSessionBrowserSelection;
export const findWorkerProfile = findAgentSessionBrowserWorkerProfile;

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
