import type {
  AgentSessionListProvider,
  AgentSessionSummary,
} from '@sniptail/core/agent-sessions/listing.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { acpAgentSessionPreviewAdapter } from '../acp/acpSessionPreviewAdapter.js';
import { openCodeAgentSessionPreviewAdapter } from '../opencode/openCodeSessionPreviewAdapter.js';
import type { ResolvedAgentWorkspace } from './workspaceResolver.js';
import type { InteractiveAgentProfile } from './interactiveAgentTypes.js';

export type AgentSessionPreviewMessage = {
  role: 'agent' | 'user';
  text: string;
  createdAt?: string;
};

export type AgentSessionPreviewAdapterInput = {
  config: WorkerConfig;
  profile: InteractiveAgentProfile;
  providerSessionId: string;
  workspaceKey?: string;
  cwd?: string;
  resolvedWorkspace?: ResolvedAgentWorkspace;
};

export type AgentSessionPreviewAdapterResult = {
  message?: AgentSessionPreviewMessage;
  errorMessage?: string;
};

export type AgentSessionPreviewAdapter = {
  provider: AgentSessionListProvider;
  previewSession(input: AgentSessionPreviewAdapterInput): Promise<AgentSessionPreviewAdapterResult>;
};

export type AgentSessionPreviewAdapterRegistry = Partial<
  Record<AgentSessionSummary['provider'], AgentSessionPreviewAdapter>
>;

export const AGENT_SESSION_PREVIEW_ADAPTERS: AgentSessionPreviewAdapterRegistry = {
  acp: acpAgentSessionPreviewAdapter,
  opencode: openCodeAgentSessionPreviewAdapter,
};

export function getAgentSessionPreviewAdapter(
  provider: AgentSessionListProvider,
  registry: AgentSessionPreviewAdapterRegistry = AGENT_SESSION_PREVIEW_ADAPTERS,
): AgentSessionPreviewAdapter | undefined {
  return registry[provider];
}
