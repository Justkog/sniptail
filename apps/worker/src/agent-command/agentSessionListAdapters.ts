import type {
  AgentSessionListFilters,
  AgentSessionListProvider,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { acpAgentSessionListAdapter } from '../acp/acpSessionListAdapter.js';
import { openCodeAgentSessionListAdapter } from '../opencode/openCodeSessionListAdapter.js';
import type { ResolvedAgentWorkspace } from './workspaceResolver.js';
import type { InteractiveAgentProfile } from './interactiveAgentTypes.js';

export type AgentSessionListAdapterPageState = {
  cursor?: string;
  offset?: number;
  anchor?: string;
  done?: boolean;
};

export type AgentSessionListAdapterInput = {
  config: WorkerConfig;
  profile: InteractiveAgentProfile;
  pageSize: number;
  cursor?: string;
  cursorState?: AgentSessionListAdapterPageState;
  filters?: AgentSessionListFilters;
  resolvedWorkspace?: ResolvedAgentWorkspace;
};

export type AgentSessionListAdapterResult = {
  sessions: AgentSessionSummary[];
  previousCursor?: string;
  nextCursor?: string;
  cursorState?: AgentSessionListAdapterPageState;
  hasMore?: boolean;
};

export type AgentSessionListAdapter = {
  provider: AgentSessionListProvider;
  listSessions(input: AgentSessionListAdapterInput): Promise<AgentSessionListAdapterResult>;
};

export type AgentSessionListAdapterRegistry = Partial<
  Record<AgentSessionListProvider, AgentSessionListAdapter>
>;

export const AGENT_SESSION_LIST_ADAPTERS: AgentSessionListAdapterRegistry = {
  acp: acpAgentSessionListAdapter,
  opencode: openCodeAgentSessionListAdapter,
};

export function getAgentSessionListAdapter(
  provider: AgentSessionListProvider,
  registry: AgentSessionListAdapterRegistry = AGENT_SESSION_LIST_ADAPTERS,
): AgentSessionListAdapter | undefined {
  return registry[provider];
}
