import { resolve } from 'node:path';
import { AGENT_REGISTRY } from '@sniptail/core/agents/agentRegistry.js';
import type { AgentId, JobSpec } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import type { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { buildJobPaths } from '@sniptail/core/jobs/utils.js';
import { resolveAgentThreadId, resolveMentionWorkingDirectory } from '../job/records.js';
import type { JobRegistry } from '../job/jobRegistry.js';
import { appendAgentEventLog } from '../job/artifacts.js';

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
}): Promise<RunAgentResult> {
  const { job, config, paths, env, registry } = options;

  const agentId = job.agent ?? config.primaryAgent;
  const agent = AGENT_REGISTRY[agentId];

  logger.info({ jobId: job.jobId, repoKeys: job.repoKeys, agent: agentId }, 'Running agent');

  const agentThreadId = await resolveAgentThreadId(job, agentId, registry);
  const mentionWorkDir = await resolveMentionWorkingDirectory(job, config.repoCacheRoot, registry);
  const modelOverride =
    agentId === 'copilot'
      ? config.copilot.models?.[job.type]
      : agentId === 'codex'
        ? config.codex.models?.[job.type]
        : undefined;

  const agentResult = await agent.run(
    job,
    job.type === 'MENTION' ? mentionWorkDir : paths.root,
    env,
    {
      botName: config.botName,
      ...(agentThreadId ? { resumeThreadId: agentThreadId } : {}),
      ...(modelOverride ? { model: modelOverride.model } : {}),
      ...(modelOverride?.modelReasoningEffort
        ? { modelReasoningEffort: modelOverride.modelReasoningEffort }
        : {}),
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
      ...(agentId === 'copilot' ? { copilotIdleRetries: config.copilot.idleRetries } : {}),
      ...(agentId === 'copilot' && config.copilot.executionMode === 'docker'
        ? {
            copilot: {
              cliPath: resolve(process.cwd(), 'scripts', 'copilot-docker.sh'),
              docker: {
                enabled: true,
                ...(config.copilot.dockerfilePath && {
                  dockerfilePath: config.copilot.dockerfilePath,
                }),
                ...(config.copilot.dockerImage && { image: config.copilot.dockerImage }),
                ...(config.copilot.dockerBuildContext && {
                  buildContext: config.copilot.dockerBuildContext,
                }),
              },
            },
          }
        : {}),
      ...(agentId === 'codex' && config.codex.executionMode === 'docker'
        ? {
            docker: {
              enabled: true,
              ...(config.codex.dockerfilePath && { dockerfilePath: config.codex.dockerfilePath }),
              ...(config.codex.dockerImage && { image: config.codex.dockerImage }),
              ...(config.codex.dockerBuildContext && {
                buildContext: config.codex.dockerBuildContext,
              }),
            },
          }
        : {}),
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
