import { runOpenCodePrompt } from '@sniptail/core/opencode/opencode.js';
import {
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import { summarizeOpenCodeEvent } from '@sniptail/core/opencode/logging.js';
import type { Notifier } from '../channels/notifier.js';
import { createDebouncedAgentOutputBuffer } from './debouncedAgentOutput.js';
import { resolveAgentWorkspace } from './workspaceResolver.js';

export type RunAgentSessionStartOptions = {
  event: CoreWorkerEvent<'agent.session.start'>;
  config: WorkerConfig;
  notifier: Notifier;
  env?: NodeJS.ProcessEnv;
};

function buildOpenCodeRunOptions(config: WorkerConfig, profileName: string) {
  return {
    botName: config.botName,
    ...(config.opencode.defaultModel
      ? {
          model: config.opencode.defaultModel.model,
          modelProvider: config.opencode.defaultModel.provider,
        }
      : {}),
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
      agent: profileName,
      startupTimeoutMs: config.opencode.startupTimeoutMs,
      dockerStreamLogs: config.opencode.dockerStreamLogs,
      ...(config.opencode.executionMode === 'docker'
        ? {
            docker: {
              enabled: true,
              ...(config.opencode.dockerfilePath
                ? { dockerfilePath: config.opencode.dockerfilePath }
                : {}),
              ...(config.opencode.dockerImage ? { image: config.opencode.dockerImage } : {}),
              ...(config.opencode.dockerBuildContext
                ? { buildContext: config.opencode.dockerBuildContext }
                : {}),
            },
          }
        : {}),
    },
  };
}

function summarizeEvent(event: unknown): { text: string; isError: boolean } | null {
  return summarizeOpenCodeEvent(event as Parameters<typeof summarizeOpenCodeEvent>[0]);
}

function formatFinalResponse(response: string): string {
  const trimmed = response.trim();
  return trimmed || 'OpenCode finished without a text response.';
}

function formatFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `OpenCode agent session failed: ${message}`;
}

export async function runAgentSessionStart({
  event,
  config,
  notifier,
  env = process.env,
}: RunAgentSessionStartOptions): Promise<void> {
  const { sessionId, response, workspaceKey, agentProfileKey, prompt, cwd } = event.payload;

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, workspaceKey, profileKey: agentProfileKey },
      'Ignoring agent session start because agent command is disabled in worker config',
    );
    return;
  }

  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
  const outputBuffer = createDebouncedAgentOutputBuffer({
    notifier,
    ref,
    debounceMs: config.agent.outputDebounceMs,
  });

  try {
    const profile = config.agent.profiles[agentProfileKey];
    if (!profile) {
      throw new Error(`Unknown agent profile key: ${agentProfileKey}`);
    }

    const resolved = await resolveAgentWorkspace(
      config.agent.workspaces,
      {
        workspaceKey,
        ...(cwd ? { cwd } : {}),
      },
      { requireExists: true },
    );

    await updateAgentSessionStatus(sessionId, 'active').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session active');
    });
    await notifier.postMessage(
      ref,
      `OpenCode running.\nWorkspace: \`${resolved.display.name}\`\nProfile: \`${agentProfileKey}\``,
    );

    logger.info(
      {
        sessionId,
        workspaceKey,
        profileKey: agentProfileKey,
        opencodeAgent: profile.name,
        resolvedCwd: resolved.resolvedCwd,
        promptLength: prompt.length,
      },
      'Starting OpenCode agent session prompt',
    );

    const result = await runOpenCodePrompt(prompt, resolved.resolvedCwd, env, {
      ...buildOpenCodeRunOptions(config, profile.name),
      runtimeId: sessionId,
      onSessionId: async (codingAgentSessionId) => {
        await updateAgentSessionCodingAgentSessionId(sessionId, codingAgentSessionId).catch(
          (err) => {
            logger.warn(
              { err, sessionId, codingAgentSessionId },
              'Failed to store OpenCode session id',
            );
          },
        );
      },
      onEvent: (opencodeEvent) => {
        const summary = summarizeEvent(opencodeEvent);
        if (!summary) return;
        if (summary.isError) {
          logger.error({ sessionId }, summary.text);
        } else {
          logger.info({ sessionId }, summary.text);
        }
      },
      onAssistantMessageCompleted: (text) => {
        outputBuffer.push(text);
      },
    });

    await outputBuffer.flush();
    await updateAgentSessionStatus(sessionId, 'completed').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session completed');
    });
    await notifier.postMessage(ref, formatFinalResponse(result.finalResponse ?? ''));
  } catch (err) {
    logger.error(
      { err, sessionId, workspaceKey, profileKey: agentProfileKey },
      'OpenCode agent session prompt failed',
    );
    await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
      logger.warn({ err: updateErr, sessionId }, 'Failed to mark agent session failed');
    });
    await outputBuffer.flush();
    await notifier.postMessage(ref, formatFailure(err));
  } finally {
    outputBuffer.close();
  }
}
