import {
  loadAgentSession,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import { abortOpenCodeSession } from '@sniptail/core/opencode/opencode.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';
import {
  clearPendingOpenCodePermissionsForSession,
  deleteActiveOpenCodeRuntime,
  getActiveOpenCodeRuntime,
} from './activeOpenCodeRuntimes.js';
import { resolveAgentWorkspace } from './workspaceResolver.js';

export type StopAgentPromptOptions = {
  event: CoreWorkerEvent<'agent.prompt.stop'>;
  config: WorkerConfig;
  notifier: Notifier;
  env?: NodeJS.ProcessEnv;
};

function buildOpenCodeAbortOptions(config: WorkerConfig, baseUrl?: string) {
  return {
    ...(baseUrl ? { baseUrl } : {}),
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
    },
  };
}

function formatStopFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Failed to stop OpenCode prompt: ${message}`;
}

export async function stopAgentPrompt({
  event,
  config,
  notifier,
  env = process.env,
}: StopAgentPromptOptions): Promise<void> {
  const { sessionId, response } = event.payload;
  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent prompt stop because agent command is disabled in worker config',
    );
    return;
  }

  try {
    const session = await loadAgentSession(sessionId);
    if (!session) {
      await notifier.postMessage(ref, 'Agent session not found.');
      return;
    }
    if (session.status !== 'active') {
      await notifier.postMessage(ref, `This agent session is ${session.status}.`);
      return;
    }

    const activeRuntime = getActiveOpenCodeRuntime(sessionId);
    const codingAgentSessionId =
      activeRuntime?.codingAgentSessionId ?? session.codingAgentSessionId;
    if (!codingAgentSessionId) {
      await notifier.postMessage(
        ref,
        'OpenCode prompt cannot be stopped yet: session is starting.',
      );
      return;
    }

    const resolved = activeRuntime
      ? undefined
      : await resolveAgentWorkspace(
          config.agent.workspaces,
          {
            workspaceKey: session.workspaceKey,
            ...(session.cwd ? { cwd: session.cwd } : {}),
          },
          { requireExists: true },
        );
    const directory = activeRuntime?.directory ?? resolved?.resolvedCwd;
    if (!directory) {
      throw new Error('Unable to resolve OpenCode working directory.');
    }

    const baseUrl =
      activeRuntime?.baseUrl ??
      (config.opencode.executionMode === 'server' ? config.opencode.serverUrl : undefined);
    if (!baseUrl) {
      await notifier.postMessage(
        ref,
        'OpenCode prompt cannot be stopped: active runtime is no longer reachable.',
      );
      return;
    }

    await abortOpenCodeSession(
      codingAgentSessionId,
      directory,
      env,
      buildOpenCodeAbortOptions(config, baseUrl),
    );
    clearPendingOpenCodePermissionsForSession(sessionId);
    deleteActiveOpenCodeRuntime(sessionId);
    await updateAgentSessionStatus(sessionId, 'stopped').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session stopped');
    });
    await notifier.postMessage(ref, 'OpenCode prompt stopped.');
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to stop OpenCode agent prompt');
    await notifier.postMessage(ref, formatStopFailure(err));
  }
}
