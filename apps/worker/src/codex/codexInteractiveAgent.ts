import {
  loadAgentSession,
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { AgentRunOptions } from '@sniptail/core/agents/types.js';
import { runCodex } from '@sniptail/core/codex/codex.js';
import { summarizeCodexEvent } from '@sniptail/core/codex/logging.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import {
  cancelAgentFollowUpSteer,
  clearAgentPromptTurn,
  isAbortingAgentPromptForSteer,
} from '../agent-command/activeAgentPromptTurns.js';
import { createDebouncedAgentOutputBuffer } from '../agent-command/debouncedAgentOutput.js';
import type {
  ResolveInteractiveAgentInteractionInput,
  RunInteractiveAgentTurnInput,
  SteerInteractiveAgentTurnInput,
  StopInteractiveAgentPromptInput,
} from '../agent-command/interactiveAgentTypes.js';
import { resolveAgentWorkspace } from '../agent-command/workspaceResolver.js';
import {
  deleteActiveCodexRuntime,
  getActiveCodexRuntime,
  setActiveCodexRuntime,
} from './codexInteractionState.js';

type CodexThreadEvent = Parameters<typeof summarizeCodexEvent>[0];

function buildRef(response: RunInteractiveAgentTurnInput['turn']['response']) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

function buildInteractiveJob(turn: RunInteractiveAgentTurnInput['turn']): JobSpec {
  return {
    jobId: turn.sessionId,
    type: 'ASK',
    repoKeys: [],
    gitRef: 'HEAD',
    requestText: turn.prompt,
    channel: {
      provider: turn.response.provider,
      channelId: turn.response.channelId,
      ...(turn.response.threadId ? { threadId: turn.response.threadId } : {}),
      ...(turn.response.userId ? { userId: turn.response.userId } : {}),
    },
    agent: 'codex',
  };
}

function buildCodexRunOptions(
  turn: RunInteractiveAgentTurnInput['turn'],
  config: RunInteractiveAgentTurnInput['config'],
  workspaceRoot: string,
  resolvedCwd: string,
): AgentRunOptions {
  const additionalDirectories = Array.from(
    new Set([
      ...(turn.cwd && workspaceRoot !== resolvedCwd ? [workspaceRoot] : []),
      ...(turn.additionalDirectories ?? []),
    ]),
  );
  const usesConfigProfile = Boolean(turn.profile.profile);
  const model =
    turn.profile.model ?? (usesConfigProfile ? undefined : config.codex.defaultModel?.model);
  const modelReasoningEffort =
    turn.profile.reasoningEffort ??
    (usesConfigProfile ? undefined : config.codex.defaultModel?.modelReasoningEffort);

  return {
    botName: config.botName,
    promptOverride: turn.prompt,
    ...(turn.profile.profile ? { configProfile: turn.profile.profile } : {}),
    ...(turn.codingAgentSessionId ? { resumeThreadId: turn.codingAgentSessionId } : {}),
    ...(model ? { model } : {}),
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    ...(turn.currentTurnAttachments?.length
      ? { currentTurnAttachments: turn.currentTurnAttachments }
      : {}),
    ...(additionalDirectories?.length ? { additionalDirectories } : {}),
    ...(config.codex.executionMode === 'docker'
      ? {
          docker: {
            enabled: true,
            ...(config.codex.dockerfilePath ? { dockerfilePath: config.codex.dockerfilePath } : {}),
            ...(config.codex.dockerImage ? { image: config.codex.dockerImage } : {}),
            ...(config.codex.dockerBuildContext
              ? { buildContext: config.codex.dockerBuildContext }
              : {}),
          },
        }
      : {}),
  };
}

function formatFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Codex agent session failed: ${message}`;
}

function formatStopFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Failed to stop Codex prompt: ${message}`;
}

async function isSessionStopped(sessionId: string): Promise<boolean> {
  const session = await loadAgentSession(sessionId).catch((err) => {
    logger.warn({ err, sessionId }, 'Failed to load agent session status');
    return undefined;
  });
  return session?.status === 'stopped';
}

export async function runCodexAgentTurn({
  turn,
  config,
  notifier,
  env,
}: RunInteractiveAgentTurnInput): Promise<void> {
  const { sessionId, workspaceKey, profile, cwd } = turn;
  const ref = buildRef(turn.response);
  const outputBuffer = createDebouncedAgentOutputBuffer({
    notifier,
    ref,
    debounceMs: config.agent.outputDebounceMs,
  });

  let latestAssistantText = '';
  let publishedAssistantText = '';
  let scheduledSnapshot: NodeJS.Timeout | undefined;
  let snapshotQueue = Promise.resolve();

  const flushAssistantSnapshot = async () => {
    if (!latestAssistantText || latestAssistantText === publishedAssistantText) return;
    publishedAssistantText = latestAssistantText;
    outputBuffer.push(latestAssistantText);
    await outputBuffer.flush();
  };

  const queueSnapshotFlush = () => {
    snapshotQueue = snapshotQueue.then(flushAssistantSnapshot, flushAssistantSnapshot);
    return snapshotQueue;
  };

  const scheduleSnapshotFlush = () => {
    if (scheduledSnapshot) return;
    scheduledSnapshot = setTimeout(() => {
      scheduledSnapshot = undefined;
      void queueSnapshotFlush().catch((err) => {
        logger.warn({ err, sessionId }, 'Failed to flush Codex assistant snapshot');
      });
    }, config.agent.outputDebounceMs);
  };

  try {
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

    logger.info(
      {
        sessionId,
        workspaceKey,
        profileKey: profile.key,
        ...(profile.model ? { codexModel: profile.model } : {}),
        ...(profile.reasoningEffort ? { codexReasoningEffort: profile.reasoningEffort } : {}),
        resolvedCwd: resolved.resolvedCwd,
        promptLength: turn.prompt.length,
      },
      'Starting Codex agent session prompt',
    );

    const result = await runCodex(buildInteractiveJob(turn), resolved.resolvedCwd, env, {
      ...buildCodexRunOptions(turn, config, resolved.workspaceRoot, resolved.resolvedCwd),
      codex: {
        onTurnReady: (runtime) => {
          setActiveCodexRuntime(sessionId, runtime);
        },
      },
      onEvent: async (event: CodexThreadEvent) => {
        const summary = summarizeCodexEvent(event);
        if (summary) {
          if (summary.isError) {
            logger.error({ sessionId }, summary.text);
          } else {
            logger.info({ sessionId }, summary.text);
          }
        }

        if (event.type === 'thread.started') {
          await updateAgentSessionCodingAgentSessionId(sessionId, event.thread_id).catch((err) => {
            logger.warn(
              { err, sessionId, codingAgentSessionId: event.thread_id },
              'Failed to store Codex thread id',
            );
          });
          return;
        }

        if (
          (event.type === 'item.updated' || event.type === 'item.completed') &&
          event.item.type === 'agent_message' &&
          event.item.text
        ) {
          latestAssistantText = event.item.text;
          scheduleSnapshotFlush();
        }
      },
    });

    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
      scheduledSnapshot = undefined;
    }
    await queueSnapshotFlush();

    if (result.threadId) {
      await updateAgentSessionCodingAgentSessionId(sessionId, result.threadId).catch((err) => {
        logger.warn(
          { err, sessionId, codingAgentSessionId: result.threadId },
          'Failed to store Codex thread id',
        );
      });
    }

    if (result.finalResponse && result.finalResponse !== publishedAssistantText) {
      outputBuffer.push(result.finalResponse);
      await outputBuffer.flush();
    }

    if (await isSessionStopped(sessionId)) {
      return;
    }
    await updateAgentSessionStatus(sessionId, 'completed').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session completed');
    });
  } catch (err) {
    if (isAbortingAgentPromptForSteer(sessionId)) {
      logger.info(
        { err, sessionId, workspaceKey, profileKey: profile.key },
        'Codex agent prompt aborted for steer follow-up',
      );
      if (scheduledSnapshot) {
        clearTimeout(scheduledSnapshot);
        scheduledSnapshot = undefined;
      }
      await queueSnapshotFlush();
      await outputBuffer.flush();
      return;
    }
    if (await isSessionStopped(sessionId)) {
      if (scheduledSnapshot) {
        clearTimeout(scheduledSnapshot);
        scheduledSnapshot = undefined;
      }
      await queueSnapshotFlush();
      await outputBuffer.flush();
      return;
    }

    logger.error(
      { err, sessionId, workspaceKey, profileKey: profile.key },
      'Codex agent session prompt failed',
    );
    await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
      logger.warn({ err: updateErr, sessionId }, 'Failed to mark agent session failed');
    });
    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
      scheduledSnapshot = undefined;
    }
    await queueSnapshotFlush();
    await outputBuffer.flush();
    await notifier.postMessage(ref, formatFailure(err));
  } finally {
    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
    }
    deleteActiveCodexRuntime(sessionId);
    outputBuffer.close();
  }
}

export function steerCodexAgentTurn({ sessionId }: SteerInteractiveAgentTurnInput): Promise<void> {
  const activeRuntime = getActiveCodexRuntime(sessionId);
  if (!activeRuntime) {
    throw new Error('active runtime is no longer reachable.');
  }
  try {
    activeRuntime.abort();
  } catch (err) {
    cancelAgentFollowUpSteer(sessionId);
    throw err;
  }
  return Promise.resolve();
}

export async function stopCodexAgentPrompt({
  event,
  notifier,
}: StopInteractiveAgentPromptInput): Promise<void> {
  const { sessionId, response } = event.payload;
  const ref = buildRef(response);
  const runtime = getActiveCodexRuntime(sessionId);
  if (!runtime) {
    await notifier.postMessage(
      ref,
      'Codex prompt cannot be stopped: active runtime is no longer reachable.',
    );
    return;
  }

  try {
    runtime.abort();
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to stop Codex prompt');
    await notifier.postMessage(ref, formatStopFailure(err));
    return;
  }

  await updateAgentSessionStatus(sessionId, 'stopped').catch((err) => {
    logger.warn({ err, sessionId }, 'Failed to mark Codex session stopped');
  });
  clearAgentPromptTurn(sessionId);
  await notifier.postMessage(ref, 'Codex prompt stopped.');
}

export async function resolveCodexAgentInteraction({
  event,
  notifier,
}: ResolveInteractiveAgentInteractionInput): Promise<void> {
  await notifier.postMessage(
    buildRef(event.payload.response),
    'Codex agent interactions are not supported.',
  );
}
