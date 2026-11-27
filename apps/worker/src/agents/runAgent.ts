import { AGENT_DESCRIPTORS } from '@sniptail/core/agents/agentRegistry.js';
import type { AgentId, JobSpec, JobThreadContextCursor } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import type { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import { resolve } from 'node:path';
import { resolveAgentContinuation, resolveMentionWorkingDirectory } from '../job/records.js';
import type { JobRegistry } from '../job/jobRegistry.js';
import { appendAgentEventLog, type MaterializedJobContextFile } from '../job/artifacts.js';
import type { Notifier } from '../channels/notifier.js';
import { buildContinuationContext } from '../job/continuationContext.js';
import {
  buildContinuationPromptForJob,
  buildPromptForJobWithLineageWarnings,
  type LineagePromptWarning,
} from '@sniptail/core/agents/buildPrompt.js';

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
type JobPaths = ReturnType<typeof buildJobPaths>;

type RunAgentResult = {
  agentId: AgentId;
  result: { threadId?: string; finalResponse?: string };
  threadContextCursor?: JobThreadContextCursor;
};

function withEffectiveThreadContext(job: JobSpec, threadContext: string | undefined): JobSpec {
  const promptJob = { ...job };
  delete promptJob.threadContext;
  if (threadContext) {
    promptJob.threadContext = threadContext;
  }
  return promptJob;
}

export async function runAgentJob(options: {
  job: JobSpec;
  config: WorkerConfig;
  paths: JobPaths;
  env: NodeJS.ProcessEnv;
  registry: JobRegistry;
  notifier: Notifier;
  currentTurnContextFiles?: MaterializedJobContextFile[];
  promptOverride?: string;
  resumeThreadId?: string;
  lineageWarnings?: LineagePromptWarning[];
  addRequestReaction?: boolean;
}): Promise<RunAgentResult> {
  const {
    job,
    config,
    paths,
    env,
    registry,
    notifier,
    currentTurnContextFiles,
    promptOverride,
    resumeThreadId,
    lineageWarnings = [],
    addRequestReaction = true,
  } = options;

  const agentId = job.agent ?? config.primaryAgent;
  const descriptor = AGENT_DESCRIPTORS[agentId];
  const agent = descriptor.adapter;

  logger.info({ jobId: job.jobId, repoKeys: job.repoKeys, agent: agentId }, 'Running agent');

  const continuation = resumeThreadId
    ? { threadId: resumeThreadId }
    : await resolveAgentContinuation(job, agentId, registry);
  const agentThreadId = continuation.threadId;
  const mentionWorkDir = await resolveMentionWorkingDirectory(
    job,
    config.repoCacheRoot,
    registry,
    config.jobWorkRoot,
  );
  const workDir = job.type === 'MENTION' ? mentionWorkDir : paths.root;
  const latestRecord = addRequestReaction
    ? await registry.loadJobRecord(job.jobId).catch((err) => {
        logger.warn({ err, jobId: job.jobId }, 'Failed to load job record before agent run');
        return undefined;
      })
    : undefined;
  const latestChannel = latestRecord?.job?.channel ?? job.channel;
  const context =
    promptOverride === undefined
      ? buildContinuationContext(
          job,
          continuation.threadContextCursor,
          Boolean(agentThreadId),
          latestChannel,
        )
      : undefined;
  const resolvedPrompt =
    promptOverride ??
    (agentThreadId
      ? buildContinuationPromptForJob({
          job,
          botName: config.botName,
          workDir,
          ...(context?.rendered ? { threadContext: context.rendered } : {}),
          threadContextMode: context?.mode ?? 'empty',
          lineageWarnings,
        })
      : buildPromptForJobWithLineageWarnings(
          withEffectiveThreadContext(job, context?.rendered),
          config.botName,
          lineageWarnings,
        ));

  logger.info(
    {
      jobId: job.jobId,
      agent: agentId,
      resumed: Boolean(agentThreadId),
      promptSource:
        promptOverride !== undefined ? 'override' : agentThreadId ? 'continuation' : 'fresh',
      ...(context
        ? {
            threadContextMode: context.mode,
            threadContextReason: context.reason,
            threadContextMessageCount: context.messageCount,
          }
        : {}),
      promptLength: resolvedPrompt.length,
    },
    'Built coding-agent turn prompt',
  );
  const modelOverride = descriptor.resolveModelConfig(config, job.type);
  const additionalDirectories = Array.from(
    new Set([
      ...(descriptor.shouldIncludeRepoCache(config, job.type) ? [config.repoCacheRoot] : []),
      ...((currentTurnContextFiles ?? []).length ? [paths.root] : []),
    ]),
  );
  const currentTurnAttachments = (currentTurnContextFiles ?? []).map((contextFile) => ({
    path: resolve(paths.root, contextFile.path),
    displayName: contextFile.originalName,
    mediaType: contextFile.mediaType,
  }));

  if (addRequestReaction) {
    if (latestChannel.requestMessageId) {
      const reactionName = latestChannel.provider === 'discord' ? '💭' : 'thought_balloon';
      try {
        await notifier.addReaction(
          {
            provider: latestChannel.provider,
            channelId: latestChannel.channelId,
            ...(latestChannel.threadId ? { threadId: latestChannel.threadId } : {}),
          },
          reactionName,
          { messageId: latestChannel.requestMessageId },
        );
      } catch (err) {
        logger.warn({ err, jobId: job.jobId }, 'Failed to add request reaction before agent run');
      }
    }
  }

  const agentResult = await agent.run(job, workDir, env, {
    botName: config.botName,
    ...(agentThreadId ? { resumeThreadId: agentThreadId } : {}),
    promptOverride: resolvedPrompt,
    includeResumeWorkDirNote: false,
    ...(currentTurnAttachments.length ? { currentTurnAttachments } : {}),
    ...(modelOverride ? { model: modelOverride.model } : {}),
    ...(modelOverride?.modelProvider ? { modelProvider: modelOverride.modelProvider } : {}),
    ...(modelOverride?.modelReasoningEffort
      ? { modelReasoningEffort: modelOverride.modelReasoningEffort }
      : {}),
    ...(additionalDirectories.length ? { additionalDirectories } : {}),
    onEvent: async (event) => {
      if (agent.formatEvent) {
        try {
          await appendAgentEventLog(paths.logFile, agent.formatEvent(event));
        } catch (err) {
          logger.warn({ err }, 'Failed to append agent event to log');
        }
      }

      const summary = agent.summarizeEvent ? agent.summarizeEvent(event) : null;
      if (!summary) return;

      if (summary.isError) {
        logger.error({ jobId: job.jobId }, summary.text);
      } else {
        logger.info({ jobId: job.jobId }, summary.text);
      }
    },
    ...descriptor.buildRunOptions(config),
    ...(job.type === 'MENTION'
      ? {
          sandboxMode: 'read-only' as const,
          approvalPolicy: 'on-request' as const,
        }
      : {}),
  });

  return {
    agentId,
    result: agentResult,
    ...(context?.cursor ? { threadContextCursor: context.cursor } : {}),
  };
}
