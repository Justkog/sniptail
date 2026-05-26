import type { AgentSessionListFilters } from '@sniptail/core/agent-sessions/listing.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  agentSessionBrowserFiltersEqual,
  findAgentSessionBrowserWorkerProfile,
  normalizeAgentSessionBrowserFilters,
  validateAgentSessionBrowserCwd,
  validateAgentSessionBrowserSelection,
} from '../agentSessionBrowserShared.js';

export const DISCORD_AGENT_SESSIONS_PAGE_SIZE = 4;

export function validateDiscordAgentSessionCwd(cwd: string | undefined): string | undefined {
  return validateAgentSessionBrowserCwd(cwd);
}

export const normalizeDiscordAgentSessionFilters = normalizeAgentSessionBrowserFilters;
export const discordAgentSessionFiltersEqual = agentSessionBrowserFiltersEqual;
export const findDiscordAgentSessionWorkerProfile = findAgentSessionBrowserWorkerProfile;
export const validateDiscordAgentSessionSelection = validateAgentSessionBrowserSelection;

export function buildDiscordAgentSessionsListWorkerEvent(input: {
  requestId: string;
  channelId: string;
  userId: string;
  guildId?: string;
  workerId: string;
  agentProfileKey?: string;
  cursor?: string;
  filters?: AgentSessionListFilters;
}): CoreWorkerEvent<'agent.sessions.list'> {
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    type: 'agent.sessions.list',
    payload: {
      response: {
        provider: 'discord',
        channelId: input.channelId,
        userId: input.userId,
        ...(input.guildId ? { guildId: input.guildId } : {}),
      },
      workerId: input.workerId,
      pageSize: DISCORD_AGENT_SESSIONS_PAGE_SIZE,
      ...(input.agentProfileKey ? { agentProfileKey: input.agentProfileKey } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
    },
  };
}

export function buildDiscordAgentSessionTimestamp(input: {
  updatedAt?: string;
  createdAt?: string;
}): string | undefined {
  const raw = input.updatedAt ?? input.createdAt;
  if (!raw) {
    return undefined;
  }
  const epochSeconds = Math.floor(Date.parse(raw) / 1000);
  if (!Number.isFinite(epochSeconds)) {
    return input.updatedAt ? `Updated: ${input.updatedAt}` : `Created: ${input.createdAt}`;
  }
  return input.updatedAt ? `Updated: <t:${epochSeconds}:R>` : `Created: <t:${epochSeconds}:R>`;
}
