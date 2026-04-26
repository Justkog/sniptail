import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { enqueueJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { createJobId } from '../lib/jobs.js';
import { resolveDefaultBaseBranch } from '../lib/repoBaseBranch.js';
import { auditJobRequest, auditNormalizedJobRequest } from '../lib/requestAudit.js';
import type { NormalizedJobRequestInput, NormalizedJobRequestResult } from './types.js';

type SubmitNormalizedJobRequestInput = {
  config: BotConfig;
  queue: QueuePublisher<JobSpec>;
  input: NormalizedJobRequestInput;
  authorize: (job: JobSpec) => Promise<boolean>;
};

type AuthorizeNormalizedJobRequestInput = Omit<SubmitNormalizedJobRequestInput, 'queue'>;

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
    agent: input.agent ?? config.primaryAgent,
    channel: input.channel,
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...(input.contextFiles ? { contextFiles: input.contextFiles } : {}),
    ...(input.resumeFromJobId ? { resumeFromJobId: input.resumeFromJobId } : {}),
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.run ? { run: input.run } : {}),
  };
}

export async function submitNormalizedJobRequest({
  config,
  queue,
  input,
  authorize,
}: SubmitNormalizedJobRequestInput): Promise<NormalizedJobRequestResult> {
  const authorizationResult = await authorizeNormalizedJobRequest({
    config,
    input,
    authorize,
  });
  if (authorizationResult.status !== 'ready') {
    return authorizationResult;
  }
  return persistAuthorizedJobRequest({
    config,
    queue,
    job: authorizationResult.job,
  });
}

export async function authorizeNormalizedJobRequest({
  config,
  input,
  authorize,
}: AuthorizeNormalizedJobRequestInput): Promise<
  Extract<NormalizedJobRequestResult, { status: 'invalid' | 'stopped' }> | { status: 'ready'; job: JobSpec }
> {
  if (input.type !== 'MENTION' && !input.repoKeys.length) {
    auditNormalizedJobRequest(config, input, 'invalid');
    return {
      status: 'invalid',
      message: 'Select at least one repository before submitting the request.',
    };
  }

  const job = buildNormalizedJobRequest(config, input);
  const authorized = await authorize(job);
  if (!authorized) {
    auditJobRequest(config, job, 'stopped');
    return {
      status: 'stopped',
      job,
    };
  }

  return {
    status: 'ready',
    job,
  };
}

export async function persistAuthorizedJobRequest(input: {
  config: BotConfig;
  queue: QueuePublisher<JobSpec>;
  job: JobSpec;
}): Promise<Extract<NormalizedJobRequestResult, { status: 'accepted' | 'persist_failed' }>> {
  const { config, queue, job } = input;
  try {
    await saveJobQueued(job);
  } catch (error) {
    auditJobRequest(config, job, 'persist_failed');
    return {
      status: 'persist_failed',
      job,
      error,
    };
  }

  await enqueueJob(queue, job);
  auditJobRequest(config, job, 'accepted');
  return {
    status: 'accepted',
    job,
  };
}
