import { logger } from '@sniptail/core/logger.js';
import {
  findLatestJobBySlackThread,
  findLatestJobBySlackThreadAndTypes,
  loadJobRecord,
} from '@sniptail/core/jobs/registry.js';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { AgentId, JobSpec } from '@sniptail/core/types/job.js';

export async function resolveThreadTs(job: JobSpec): Promise<string | undefined> {
  try {
    const record = await loadJobRecord(job.jobId);
    return record?.job?.slack?.threadTs ?? job.slack.threadTs;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve job thread timestamp');
    return job.slack.threadTs;
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
  const threadTs = await resolveThreadTs(job);
  if (!threadTs) return undefined;
  try {
    const record = await findLatestJobBySlackThread(job.slack.channelId, threadTs, agentId);
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
  const threadTs = await resolveThreadTs(job);
  if (!threadTs) return fallback;
  try {
    const record = await findLatestJobBySlackThreadAndTypes(job.slack.channelId, threadTs, [
      'ASK',
      'IMPLEMENT',
    ]);
    if (!record) return fallback;
    return buildJobPaths(record.job.jobId).root;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve working directory from previous job');
    return fallback;
  }
}
