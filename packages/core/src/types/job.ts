import type { ChannelContext } from './channel.js';
import type { RunActionParamValue } from '../repos/runActions.js';

export type { RunActionParamValue as RunParamValue };

export type JobType = 'ASK' | 'EXPLORE' | 'IMPLEMENT' | 'PLAN' | 'REVIEW' | 'RUN' | 'MENTION';
export const AGENT_IDS = ['codex', 'copilot', 'opencode', 'acp'] as const;
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

export type JobContextFileSource = {
  provider: ChannelContext['provider'];
  externalId: string;
  metadata?: Record<string, string>;
};

export type JobContextFile = {
  originalName: string;
  mediaType: string;
  byteSize: number;
  contentBase64: string;
  source?: JobContextFileSource;
};

export type JobThreadContextMessage = {
  externalId: string;
  orderKey: string;
  author: string;
  text: string;
};

export type JobThreadContextCursor = {
  provider: ChannelContext['provider'];
  channelId: string;
  threadId: string;
  messageId: string;
  orderKey: string;
};

export type JobThreadContextSnapshot = {
  version: 1;
  provider: ChannelContext['provider'];
  channelId: string;
  threadId: string;
  messages: JobThreadContextMessage[];
  rendered: string;
  coversThreadRoot?: boolean;
  cursor?: JobThreadContextCursor;
};

export type RunJobInput = {
  actionId: string;
  params?: Record<string, RunActionParamValue>;
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
  agentThreadContextCursors?: Partial<Record<AgentId, JobThreadContextCursor>>;
  threadContext?: string;
  threadContextSnapshot?: JobThreadContextSnapshot;
  resumeFromJobId?: string;
  contextFiles?: JobContextFile[];
  settings?: JobSettings;
  run?: RunJobInput;
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
