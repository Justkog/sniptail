import { logger } from '@sniptail/core/logger.js';
import {
  findLatestJobByChannelThread,
  findLatestJobByChannelThreadAndTypes,
  loadJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { AgentId, JobSpec } from '@sniptail/core/types/job.js';

export async function resolveThreadId(job: JobSpec): Promise<string | undefined> {
  try {
    const record = await loadJobRecord(job.jobId);
    return record?.job?.channel?.threadId ?? job.channel.threadId;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve job thread id');
    return job.channel.threadId;
  }
}

function getAgentThreadId(job: JobSpec, agentId: AgentId): string | undefined {
  if (job.agentThreadIds?.[agentId]) {
    return job.agentThreadIds[agentId];
  }
  return undefined;
}

export async function resolveAgentThreadId(
  job: JobSpec,
  agentId: AgentId,
): Promise<string | undefined> {
  const jobThreadId = getAgentThreadId(job, agentId);
  if (jobThreadId) {
    return jobThreadId;
  }
  if (job.resumeFromJobId) {
    try {
      const record = await loadJobRecord(job.resumeFromJobId);
      const resumeThreadId = record?.job ? getAgentThreadId(record.job, agentId) : undefined;
      if (resumeThreadId) {
        return resumeThreadId;
      }
    } catch (err) {
      logger.warn(
        { err, jobId: job.jobId, agentId },
        'Failed to resolve agent thread id from resumed job',
      );
    }
  }
  const threadId = await resolveThreadId(job);
  if (!threadId) return undefined;
  try {
    const record = await findLatestJobByChannelThread(
      job.channel.provider,
      job.channel.channelId,
      threadId,
      agentId,
    );
    return record?.job ? getAgentThreadId(record.job, agentId) : undefined;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId, agentId }, 'Failed to resolve agent thread id');
    return undefined;
  }
}

export async function resolveMentionWorkingDirectory(
  job: JobSpec,
  fallback: string,
): Promise<string> {
  if (job.type !== 'MENTION') return fallback;
  const threadId = await resolveThreadId(job);
  if (!threadId) return fallback;
  try {
    const record = await findLatestJobByChannelThreadAndTypes(
      job.channel.provider,
      job.channel.channelId,
      threadId,
      ['ASK', 'PLAN', 'IMPLEMENT'],
    );
    if (!record) return fallback;
    return buildJobPaths(record.job.jobId).root;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve working directory from previous job');
    return fallback;
  }
}
