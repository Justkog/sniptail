export type AgentSessionListProvider = 'acp' | 'opencode' | 'copilot';

export type AgentSessionSummary = {
  id: string;
  provider: AgentSessionListProvider;
  agentProfileKey: string;
  workspaceKey?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  cwd?: string;
  project?: string;
  description?: string;
};

export type AgentSessionListFilters = {
  workspaceKey?: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
  roots?: string[];
  search?: string;
  start?: string;
};
