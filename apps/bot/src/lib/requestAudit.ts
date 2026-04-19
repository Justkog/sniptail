import type { BotConfig } from '@sniptail/core/config/config.js';
import { createFileTransportLogger, logger, type Logger } from '@sniptail/core/logger.js';
import type { ChannelContext } from '@sniptail/core/types/channel.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { NormalizedJobRequestInput } from '../job-requests/types.js';

type RequestAuditOutcome = 'invalid' | 'stopped' | 'persist_failed' | 'accepted';

type RequestAuditRecord = {
  event: 'job.request';
  outcome: RequestAuditOutcome;
  jobId?: string;
  jobType: JobSpec['type'] | NormalizedJobRequestInput['type'];
  provider: ChannelContext['provider'];
  channelId: string;
  threadId?: string;
  userId?: string;
  requestId?: string;
  requestText: string;
  repoKeys: string[];
  primaryRepoKey?: string;
  gitRef?: string;
  agent?: JobSpec['agent'];
  resumeFromJobId?: string;
  contextFileCount: number;
  runActionId?: string;
  metadata?: Record<string, unknown>;
  guildId?: string;
};

const auditLoggerCache = new Map<string, Logger | null>();

function resolveAuditLogger(config: BotConfig): Logger | null {
  const destination = config.auditLogPath?.trim();
  if (!destination) {
    return null;
  }

  const cached = auditLoggerCache.get(destination);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const auditLogger = createFileTransportLogger(destination);
    auditLoggerCache.set(destination, auditLogger);
    return auditLogger;
  } catch (err) {
    logger.warn({ err, destination }, 'Failed to initialize request audit logger');
    auditLoggerCache.set(destination, null);
    return null;
  }
}

function toAuditRecordFromJob(
  job: JobSpec,
  outcome: RequestAuditOutcome,
): RequestAuditRecord {
  return {
    event: 'job.request',
    outcome,
    jobId: job.jobId,
    jobType: job.type,
    provider: job.channel.provider,
    channelId: job.channel.channelId,
    ...(job.channel.threadId ? { threadId: job.channel.threadId } : {}),
    ...(job.channel.userId ? { userId: job.channel.userId } : {}),
    ...(job.channel.requestId ? { requestId: job.channel.requestId } : {}),
    requestText: job.requestText,
    repoKeys: job.repoKeys,
    ...(job.primaryRepoKey ? { primaryRepoKey: job.primaryRepoKey } : {}),
    gitRef: job.gitRef,
    ...(job.agent ? { agent: job.agent } : {}),
    ...(job.resumeFromJobId ? { resumeFromJobId: job.resumeFromJobId } : {}),
    contextFileCount: job.contextFiles?.length ?? 0,
    ...(job.run?.actionId ? { runActionId: job.run.actionId } : {}),
    ...(job.channel.metadata ? { metadata: job.channel.metadata } : {}),
    ...('guildId' in job.channel && job.channel.guildId ? { guildId: job.channel.guildId } : {}),
  };
}

function toAuditRecordFromInput(
  input: NormalizedJobRequestInput,
  outcome: Extract<RequestAuditOutcome, 'invalid'>,
): RequestAuditRecord {
  return {
    event: 'job.request',
    outcome,
    jobType: input.type,
    provider: input.channel.provider,
    channelId: input.channel.channelId,
    ...(input.channel.threadId ? { threadId: input.channel.threadId } : {}),
    ...(input.channel.userId ? { userId: input.channel.userId } : {}),
    ...(input.channel.requestId ? { requestId: input.channel.requestId } : {}),
    requestText: input.requestText,
    repoKeys: input.repoKeys,
    ...(input.gitRef ? { gitRef: input.gitRef } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.resumeFromJobId ? { resumeFromJobId: input.resumeFromJobId } : {}),
    contextFileCount: input.contextFiles?.length ?? 0,
    ...(input.run?.actionId ? { runActionId: input.run.actionId } : {}),
    ...(input.channel.metadata ? { metadata: input.channel.metadata } : {}),
    ...('guildId' in input.channel && input.channel.guildId ? { guildId: input.channel.guildId } : {}),
  };
}

function writeAuditRecord(config: BotConfig, record: RequestAuditRecord): void {
  const auditLogger = resolveAuditLogger(config);
  if (!auditLogger) {
    return;
  }

  try {
    auditLogger.info(record);
  } catch (err) {
    logger.warn({ err, event: record.event, outcome: record.outcome }, 'Failed to write request audit record');
  }
}

export function auditNormalizedJobRequest(
  config: BotConfig,
  input: NormalizedJobRequestInput,
  outcome: Extract<RequestAuditOutcome, 'invalid'>,
): void {
  writeAuditRecord(config, toAuditRecordFromInput(input, outcome));
}

export function auditJobRequest(
  config: BotConfig,
  job: JobSpec,
  outcome: Exclude<RequestAuditOutcome, 'invalid'>,
): void {
  writeAuditRecord(config, toAuditRecordFromJob(job, outcome));
}
