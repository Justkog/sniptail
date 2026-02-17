import type { ChannelContext } from './channel.js';

export type JobType = 'ASK' | 'IMPLEMENT' | 'PLAN' | 'REVIEW' | 'MENTION';
export const AGENT_IDS = ['codex', 'copilot'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type RepoConfig = {
  provider?: string;
  providerData?: Record<string, unknown>;
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  baseBranch?: string;
};

export type JobSettings = {
  checks?: string[];
  labels?: string[];
  reviewers?: string[];
};

export type JobSpec = {
  jobId: string;
  type: JobType;
  repoKeys: string[];
  primaryRepoKey?: string;
  gitRef: string;
  requestText: string;
  channel: ChannelContext;
  agent?: AgentId;
  agentThreadIds?: Partial<Record<AgentId, string>>;
  threadContext?: string;
  resumeFromJobId?: string;
  settings?: JobSettings;
};

export type MergeRequestResult = {
  repoKey: string;
  url: string;
  iid: number;
};

export type JobResult = {
  jobId: string;
  status: 'ok' | 'failed';
  summary: string;
  reportPath?: string;
  mergeRequests?: MergeRequestResult[];
};
