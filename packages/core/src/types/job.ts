import type { ChannelContext } from './channel.js';

export type JobType = 'ASK' | 'IMPLEMENT' | 'PLAN' | 'MENTION';
export type AgentId = 'codex' | 'copilot';

export type RepoConfig = {
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
