import { AGENT_DESCRIPTORS } from '@sniptail/core/agents/agentRegistry.js';
import type { AgentId, JobSpec } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import type { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import { resolve } from 'node:path';
import { resolveAgentThreadId, resolveMentionWorkingDirectory } from '../job/records.js';
import type { JobRegistry } from '../job/jobRegistry.js';
import { appendAgentEventLog, type MaterializedJobContextFile } from '../job/artifacts.js';

type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
type JobPaths = ReturnType<typeof buildJobPaths>;

type RunAgentResult = {
  agentId: AgentId;
  result: { threadId?: string; finalResponse?: string };
};

export async function runAgentJob(options: {
  job: JobSpec;
  config: WorkerConfig;
  paths: JobPaths;
  env: NodeJS.ProcessEnv;
  registry: JobRegistry;
  currentTurnContextFiles?: MaterializedJobContextFile[];
  promptOverride?: string;
}): Promise<RunAgentResult> {
  const { job, config, paths, env, registry, currentTurnContextFiles, promptOverride } = options;

  const agentId = job.agent ?? config.primaryAgent;
  const descriptor = AGENT_DESCRIPTORS[agentId];
  const agent = descriptor.adapter;

  logger.info({ jobId: job.jobId, repoKeys: job.repoKeys, agent: agentId }, 'Running agent');

  const agentThreadId = await resolveAgentThreadId(job, agentId, registry);
  const mentionWorkDir = await resolveMentionWorkingDirectory(
    job,
    config.repoCacheRoot,
    registry,
    config.jobWorkRoot,
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

  const agentResult = await agent.run(
    job,
    job.type === 'MENTION' ? mentionWorkDir : paths.root,
    env,
    {
      botName: config.botName,
      ...(agentThreadId ? { resumeThreadId: agentThreadId } : {}),
      ...(promptOverride ? { promptOverride } : {}),
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
    },
  );

  return { agentId, result: agentResult };
}
