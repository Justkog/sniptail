import { basename } from 'node:path';
import {
  loadAgentSession,
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import { extractAcpAssistantText, summarizeAcpEvent } from '@sniptail/core/acp/acpEventMapping.js';
import { launchAcpRuntime } from '@sniptail/core/acp/acpRuntime.js';
import { logger } from '@sniptail/core/logger.js';
import {
  clearAgentPromptTurn,
  cancelAgentFollowUpSteer,
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
  buildAcpPermissionHandler,
  clearAcpPermissionInteractions,
  resolveAcpPermissionInteraction,
} from './acpPermissionBridge.js';
import {
  buildAcpQuestionHandler,
  clearAcpQuestionInteractions,
  resolveAcpQuestionInteraction,
} from './acpQuestionBridge.js';
import {
  deleteActiveAcpRuntime,
  getActiveAcpRuntime,
  setActiveAcpRuntime,
} from './acpInteractionState.js';

type AcpNotification = Parameters<typeof summarizeAcpEvent>[0];
type AcpSessionHandle = { sessionId: string };

function buildRef(response: RunInteractiveAgentTurnInput['turn']['response']) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

function formatFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `ACP agent session failed: ${message}`;
}

function formatStopFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Failed to stop ACP prompt: ${message}`;
}

function launchCommandLabel(command: string[]): string | undefined {
  const executable = command[0];
  return executable ? basename(executable) : undefined;
}

async function isSessionStopped(sessionId: string): Promise<boolean> {
  const session = await loadAgentSession(sessionId).catch((err) => {
    logger.warn({ err, sessionId }, 'Failed to load agent session status');
    return undefined;
  });
  return session?.status === 'stopped';
}

async function startOrLoadAcpSession(
  runtime: Awaited<ReturnType<typeof launchAcpRuntime>>,
  turn: RunInteractiveAgentTurnInput['turn'],
  resolvedCwd: string,
): Promise<{ sessionId: string; persisted: boolean }> {
  const sessionOptions = {
    cwd: resolvedCwd,
    ...(turn.additionalDirectories?.length
      ? { additionalDirectories: turn.additionalDirectories }
      : {}),
  };

  if (turn.codingAgentSessionId) {
    const session = (await runtime.loadSession(
      turn.codingAgentSessionId,
      sessionOptions,
    )) as AcpSessionHandle;
    return {
      sessionId: session.sessionId,
      persisted: false,
    };
  }

  const session = (await runtime.createSession(sessionOptions)) as AcpSessionHandle;
  return {
    sessionId: session.sessionId,
    persisted: true,
  };
}

export async function runAcpAgentTurn({
  turn,
  config,
  notifier,
  botEvents,
  env,
}: RunInteractiveAgentTurnInput): Promise<void> {
  const { sessionId, workspaceKey, profile, cwd } = turn;
  const ref = buildRef(turn.response);
  const outputBuffer = createDebouncedAgentOutputBuffer({
    notifier,
    ref,
    debounceMs: config.agent.outputDebounceMs,
  });
  const acpCommand = profile.provider === 'acp' ? launchCommandLabel(profile.command) : undefined;
  let runtime: Awaited<ReturnType<typeof launchAcpRuntime>> | undefined;
  let latestAssistantText = '';
  let publishedAssistantText = '';
  let scheduledSnapshot: NodeJS.Timeout | undefined;
  let snapshotQueue = Promise.resolve();
  let isCapturingAssistantOutput = false;

  const flushAssistantSnapshot = async () => {
    if (!latestAssistantText || latestAssistantText === publishedAssistantText) return;
    const nextText = latestAssistantText;
    const delta = nextText.startsWith(publishedAssistantText)
      ? nextText.slice(publishedAssistantText.length)
      : nextText;
    publishedAssistantText = nextText;
    outputBuffer.push(delta, { preserveWhitespace: true });
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
        logger.warn({ err, sessionId }, 'Failed to flush ACP assistant snapshot');
      });
    }, config.agent.outputDebounceMs);
  };

  try {
    if (profile.provider !== 'acp') {
      throw new Error(`Invalid ACP interactive profile provider: ${profile.provider}`);
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

    logger.info(
      {
        sessionId,
        workspaceKey,
        profileKey: profile.key,
        resolvedCwd: resolved.resolvedCwd,
        promptLength: turn.prompt.length,
        ...(profile.agent ? { acpAgent: profile.agent } : {}),
        ...(profile.profile ? { acpProfile: profile.profile } : {}),
        ...(acpCommand ? { acpCommand } : {}),
      },
      'Starting ACP agent session prompt',
    );

    runtime = await launchAcpRuntime({
      launch: profile,
      cwd: resolved.resolvedCwd,
      env,
      diagnostics: {
        configSource: `agent.profiles.${profile.key}`,
      },
      onRequestPermission: buildAcpPermissionHandler({
        sessionId,
        response: turn.response,
        workspaceKey,
        cwd: resolved.resolvedCwd,
        timeoutMs: config.agent.interactionTimeoutMs,
        botEvents,
      }),
      onCreateElicitation: buildAcpQuestionHandler({
        sessionId,
        response: turn.response,
        workspaceKey,
        cwd: resolved.resolvedCwd,
        timeoutMs: config.agent.interactionTimeoutMs,
        botEvents,
        flushOutput: async () => {
          if (scheduledSnapshot) {
            clearTimeout(scheduledSnapshot);
            scheduledSnapshot = undefined;
          }
          await queueSnapshotFlush();
          await outputBuffer.flush();
        },
      }),
      onSessionUpdate: (notification: AcpNotification) => {
        const summary = summarizeAcpEvent(notification);
        if (summary) {
          if (summary.isError) {
            logger.error({ sessionId }, summary.text);
          } else {
            logger.info({ sessionId }, summary.text);
          }
        }

        const assistantText = extractAcpAssistantText(notification);
        if (!assistantText || !isCapturingAssistantOutput) {
          return;
        }
        latestAssistantText += assistantText;
        scheduleSnapshotFlush();
      },
    });

    const session = await startOrLoadAcpSession(runtime, turn, resolved.resolvedCwd);
    if (session.persisted) {
      await updateAgentSessionCodingAgentSessionId(sessionId, session.sessionId).catch((err) => {
        logger.warn(
          { err, sessionId, codingAgentSessionId: session.sessionId },
          'Failed to store ACP session id',
        );
      });
    }

    setActiveAcpRuntime(sessionId, {
      sessionId,
      codingAgentSessionId: session.sessionId,
      directory: resolved.resolvedCwd,
      cancel: runtime.cancel.bind(runtime),
    });

    isCapturingAssistantOutput = true;
    await runtime.prompt({
      prompt: turn.prompt,
      ...(turn.currentTurnAttachments && { attachments: turn.currentTurnAttachments }),
    });
    isCapturingAssistantOutput = false;

    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
      scheduledSnapshot = undefined;
    }
    await queueSnapshotFlush();

    if (await isSessionStopped(sessionId)) {
      return;
    }
    await updateAgentSessionStatus(sessionId, 'completed').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session completed');
    });
  } catch (err) {
    isCapturingAssistantOutput = false;
    if (isAbortingAgentPromptForSteer(sessionId)) {
      logger.info(
        { err, sessionId, workspaceKey, profileKey: profile.key },
        'ACP agent prompt aborted for steer follow-up',
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
      {
        err,
        sessionId,
        workspaceKey,
        profileKey: profile.key,
        ...(profile.agent ? { acpAgent: profile.agent } : {}),
        ...(acpCommand ? { acpCommand } : {}),
      },
      'ACP agent session prompt failed',
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
    await clearAcpPermissionInteractions({ sessionId, botEvents }).catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to clear ACP permission interactions');
    });
    await clearAcpQuestionInteractions({ sessionId, botEvents }).catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to clear ACP question interactions');
    });
    deleteActiveAcpRuntime(sessionId);
    await runtime?.close().catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to close ACP runtime');
    });
    outputBuffer.close();
  }
}

export function steerAcpAgentTurn({ sessionId }: SteerInteractiveAgentTurnInput): Promise<void> {
  const activeRuntime = getActiveAcpRuntime(sessionId);
  if (!activeRuntime) {
    cancelAgentFollowUpSteer(sessionId);
    throw new Error('ACP prompt steering is not supported: active runtime is no longer reachable.');
  }
  return activeRuntime.cancel().catch((err) => {
    cancelAgentFollowUpSteer(sessionId);
    throw err;
  });
}

export async function stopAcpAgentPrompt({
  event,
  botEvents,
  notifier,
}: StopInteractiveAgentPromptInput): Promise<void> {
  const { sessionId, response } = event.payload;
  const ref = buildRef(response);
  const activeRuntime = getActiveAcpRuntime(sessionId);
  if (!activeRuntime) {
    await notifier.postMessage(
      ref,
      'ACP prompt cannot be stopped: active runtime is no longer reachable.',
    );
    return;
  }

  try {
    await activeRuntime.cancel();
    await clearAcpPermissionInteractions({
      sessionId,
      botEvents,
      message: 'ACP prompt stopped before this interaction was resolved.',
    });
    await clearAcpQuestionInteractions({
      sessionId,
      botEvents,
      message: 'ACP prompt stopped before this interaction was resolved.',
    });
    deleteActiveAcpRuntime(sessionId);
    clearAgentPromptTurn(sessionId);
    await updateAgentSessionStatus(sessionId, 'stopped').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark ACP session stopped');
    });
    await notifier.postMessage(ref, 'ACP prompt stopped.');
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to stop ACP prompt');
    await notifier.postMessage(ref, formatStopFailure(err));
  }
}

export async function resolveAcpAgentInteraction({
  event,
  notifier,
  botEvents,
}: ResolveInteractiveAgentInteractionInput): Promise<void> {
  if (event.payload.resolution.kind === 'permission') {
    await resolveAcpPermissionInteraction({
      event,
      notifier,
      botEvents,
    });
    return;
  }
  await resolveAcpQuestionInteraction({
    event,
    notifier,
    botEvents,
  });
}
