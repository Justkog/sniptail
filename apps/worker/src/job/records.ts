import { logger } from '@sniptail/core/logger.js';
import { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import type { AgentId, JobSpec } from '@sniptail/core/types/job.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { JobRegistry } from './jobRegistry.js';

export type AgentContinuation = {
  threadId?: string;
  sourceRecord?: JobRecord;
  sourceJob?: JobSpec;
};

export async function resolveThreadId(
  job: JobSpec,
  registry: JobRegistry,
): Promise<string | undefined> {
  try {
    const record = await registry.loadJobRecord(job.jobId);
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

export async function resolveAgentContinuation(
  job: JobSpec,
  agentId: AgentId,
  registry: JobRegistry,
): Promise<AgentContinuation> {
  const jobThreadId = getAgentThreadId(job, agentId);
  if (jobThreadId) {
    return { threadId: jobThreadId, sourceJob: job };
  }
  if (job.resumeFromJobId) {
    try {
      const record = await registry.loadJobRecord(job.resumeFromJobId);
      const resumeThreadId = record?.job ? getAgentThreadId(record.job, agentId) : undefined;
      if (resumeThreadId) {
        return {
          threadId: resumeThreadId,
          ...(record ? { sourceRecord: record } : {}),
          ...(record?.job ? { sourceJob: record.job } : {}),
        };
      }
    } catch (err) {
      logger.warn(
        { err, jobId: job.jobId, agentId },
        'Failed to resolve agent thread id from resumed job',
      );
    }
  }
  const threadId = await resolveThreadId(job, registry);
  if (!threadId) return {};
  try {
    const record = await registry.findLatestJobByChannelThread(
      job.channel.provider,
      job.channel.channelId,
      threadId,
      agentId,
    );
    const resolvedThreadId = record?.job ? getAgentThreadId(record.job, agentId) : undefined;
    return {
      ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      ...(record ? { sourceRecord: record } : {}),
      ...(record?.job ? { sourceJob: record.job } : {}),
    };
  } catch (err) {
    logger.warn({ err, jobId: job.jobId, agentId }, 'Failed to resolve agent thread id');
    return {};
  }
}

export async function resolveAgentThreadId(
  job: JobSpec,
  agentId: AgentId,
  registry: JobRegistry,
): Promise<string | undefined> {
  return (await resolveAgentContinuation(job, agentId, registry)).threadId;
}

export async function resolveMentionWorkingDirectory(
  job: JobSpec,
  fallback: string,
  registry: JobRegistry,
  jobWorkRoot: string,
): Promise<string> {
  if (job.type !== 'MENTION') return fallback;
  const threadId = await resolveThreadId(job, registry);
  if (!threadId) return fallback;
  try {
    const record = await registry.findLatestJobByChannelThreadAndTypes(
      job.channel.provider,
      job.channel.channelId,
      threadId,
      ['ASK', 'EXPLORE', 'PLAN', 'IMPLEMENT'],
    );
    if (!record) return fallback;
    const resolvedWorkDir = buildJobPaths(jobWorkRoot, record.job.jobId).root;
    logger.info(
      {
        jobId: job.jobId,
        provider: job.channel.provider,
        channelId: job.channel.channelId,
        threadId,
        resumeFromJobId: record.job.jobId,
        agentWorkDir: resolvedWorkDir,
      },
      'Resolved mention working directory from previous job',
    );
    return resolvedWorkDir;
  } catch (err) {
    logger.warn({ err, jobId: job.jobId }, 'Failed to resolve working directory from previous job');
    return fallback;
  }
}
