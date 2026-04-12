import type { ChannelContext } from '@sniptail/core/types/channel.js';
import type { JobContextFile, JobSpec, JobType } from '@sniptail/core/types/job.js';

export type NormalizedJobRequestInput = {
  type: JobType;
  repoKeys: string[];
  gitRef?: string;
  requestText: string;
  agent?: JobSpec['agent'];
  channel: ChannelContext;
  threadContext?: string;
  contextFiles?: JobContextFile[];
  resumeFromJobId?: string;
  settings?: JobSpec['settings'];
  run?: JobSpec['run'];
};

export type NormalizedJobRequestResult =
  | { status: 'accepted'; job: JobSpec }
  | { status: 'stopped'; job: JobSpec }
  | { status: 'invalid'; message: string }
  | { status: 'persist_failed'; job: JobSpec; error: unknown };
