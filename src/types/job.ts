export type JobType = 'ASK' | 'IMPLEMENT' | 'MENTION';

export type RepoConfig = {
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  baseBranch?: string;
};

export type SlackContext = {
  channelId: string;
  threadTs?: string;
  userId: string;
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
  slack: SlackContext;
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
