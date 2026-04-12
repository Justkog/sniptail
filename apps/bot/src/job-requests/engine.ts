import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../lib/repoBaseBranch.js';
import type { NormalizedJobRequestInput, NormalizedJobRequestResult } from './types.js';

type SubmitNormalizedJobRequestInput = {
  config: BotConfig;
  queue: QueuePublisher<JobSpec>;
  input: NormalizedJobRequestInput;
  authorize: (job: JobSpec) => Promise<boolean>;
};

function toJobIdPrefix(type: NormalizedJobRequestInput['type']): string {
  return type.toLowerCase();
}

export function buildNormalizedJobRequest(
  config: BotConfig,
  input: NormalizedJobRequestInput,
): JobSpec {
  return {
    jobId: createJobId(toJobIdPrefix(input.type)),
    type: input.type,
    repoKeys: input.repoKeys,
    ...(input.repoKeys[0] ? { primaryRepoKey: input.repoKeys[0] } : {}),
    gitRef: input.gitRef || resolveDefaultBaseBranch(config.repoAllowlist, input.repoKeys[0]),
    requestText: input.requestText,
    agent: config.primaryAgent,
    channel: input.channel,
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...(input.contextFiles ? { contextFiles: input.contextFiles } : {}),
    ...(input.resumeFromJobId ? { resumeFromJobId: input.resumeFromJobId } : {}),
    ...(input.run ? { run: input.run } : {}),
  };
}

export async function submitNormalizedJobRequest({
  config,
  queue,
  input,
  authorize,
}: SubmitNormalizedJobRequestInput): Promise<NormalizedJobRequestResult> {
  if (!input.repoKeys.length) {
    return {
      status: 'invalid',
      message: 'Select at least one repository before submitting the request.',
    };
  }

  const job = buildNormalizedJobRequest(config, input);
  const authorized = await authorize(job);
  if (!authorized) {
    return {
      status: 'stopped',
      job,
    };
  }

  try {
    await saveJobQueued(job);
  } catch (error) {
    return {
      status: 'persist_failed',
      job,
      error,
    };
  }

  await enqueueJob(queue, job);
  return {
    status: 'accepted',
    job,
  };
}
