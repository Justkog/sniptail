import {
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import { resolveWorkerAgentScriptPath } from '@sniptail/core/agents/resolveWorkerAgentScriptPath.js';
import type { AgentRunOptions } from '@sniptail/core/agents/types.js';
import { logger } from '@sniptail/core/logger.js';
import { runCopilot } from '@sniptail/core/copilot/copilot.js';
import { summarizeCopilotEvent } from '@sniptail/core/copilot/logging.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import {
  buildCopilotPermissionHandler,
  buildCopilotUserInputHandler,
  clearBrokeredCopilotInteractions,
  resolveBrokeredCopilotInteraction,
} from '../agent-command/interactiveAgentInteractionBroker.js';
import { createDebouncedAgentOutputBuffer } from '../agent-command/debouncedAgentOutput.js';
import type {
  ResolveInteractiveAgentInteractionInput,
  RunInteractiveAgentTurnInput,
  SteerInteractiveAgentTurnInput,
  StopInteractiveAgentPromptInput,
} from '../agent-command/interactiveAgentTypes.js';
import { resolveAgentWorkspace } from '../agent-command/workspaceResolver.js';

const COPILOT_AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type CopilotRunOptions = NonNullable<AgentRunOptions['copilot']>;
type CopilotPermissionRequest = Parameters<
  NonNullable<CopilotRunOptions['onPermissionRequest']>
>[0];
type CopilotPermissionInvocation = Parameters<
  NonNullable<CopilotRunOptions['onPermissionRequest']>
>[1];
type CopilotUserInputRequest = Parameters<
  NonNullable<CopilotRunOptions['onUserInputRequest']>
>[0];
type CopilotUserInputInvocation = Parameters<
  NonNullable<CopilotRunOptions['onUserInputRequest']>
>[1];

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
    agent: 'copilot',
  };
}

function buildCopilotRunOptions(
  turn: RunInteractiveAgentTurnInput['turn'],
  config: RunInteractiveAgentTurnInput['config'],
  workspaceRoot: string,
  resolvedCwd: string,
): AgentRunOptions {
  const additionalDirectories =
    turn.cwd && workspaceRoot !== resolvedCwd ? [workspaceRoot] : undefined;
  const model = turn.profile.model ?? config.copilot.defaultModel?.model;
  const modelProvider = config.copilot.defaultModel?.modelProvider;
  const modelReasoningEffort =
    turn.profile.reasoningEffort ?? config.copilot.defaultModel?.modelReasoningEffort;

  return {
    botName: config.botName,
    promptOverride: turn.prompt,
    ...(turn.codingAgentSessionId ? { resumeThreadId: turn.codingAgentSessionId } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    ...(additionalDirectories?.length ? { additionalDirectories } : {}),
    copilot: {
      streaming: true,
      ...(turn.profile.name ? { agent: turn.profile.name } : {}),
      ...(config.copilot.executionMode === 'docker'
        ? {
            cliPath: resolveWorkerAgentScriptPath('copilot-docker.sh'),
            docker: {
              enabled: true,
              ...(config.copilot.dockerfilePath
                ? { dockerfilePath: config.copilot.dockerfilePath }
                : {}),
              ...(config.copilot.dockerImage ? { image: config.copilot.dockerImage } : {}),
              ...(config.copilot.dockerBuildContext
                ? { buildContext: config.copilot.dockerBuildContext }
                : {}),
            },
          }
        : {}),
    },
    copilotIdleRetries: config.copilot.idleRetries,
    copilotIdleTimeoutMs: COPILOT_AGENT_IDLE_TIMEOUT_MS,
  };
}

function formatFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Copilot agent session failed: ${message}`;
}

function unsupportedSteerError(): Error {
  return new Error('Copilot prompt steering is not supported yet.');
}

function unsupportedStopMessage(): string {
  return 'Copilot prompt stopping is not supported yet.';
}

export async function runCopilotAgentTurn({
  turn,
  config,
  notifier,
  botEvents,
  env,
}: RunInteractiveAgentTurnInput): Promise<void> {
  const { sessionId, response, workspaceKey, profile, cwd } = turn;
  const ref = buildRef(turn.response);
  const outputBuffer = createDebouncedAgentOutputBuffer({
    notifier,
    ref,
    debounceMs: config.agent.outputDebounceMs,
  });

  let latestAssistantText = '';
  let publishedAssistantText = '';
  let sawMessageDelta = false;
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
        logger.warn({ err, sessionId }, 'Failed to flush Copilot assistant snapshot');
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
        ...(profile.name ? { copilotAgent: profile.name } : {}),
        ...(profile.model ? { copilotModel: profile.model } : {}),
        ...(profile.reasoningEffort ? { copilotReasoningEffort: profile.reasoningEffort } : {}),
        resolvedCwd: resolved.resolvedCwd,
        promptLength: turn.prompt.length,
      },
      'Starting Copilot agent session prompt',
    );

    const runOptions = buildCopilotRunOptions(
      turn,
      config,
      resolved.workspaceRoot,
      resolved.resolvedCwd,
    );
    const onPermissionRequest = buildCopilotPermissionHandler({
      sessionId,
      response,
      workspaceKey,
      ...(cwd ? { cwd } : {}),
      timeoutMs: config.agent.interactionTimeoutMs,
      botEvents,
    });
    const onUserInputRequest = buildCopilotUserInputHandler({
      sessionId,
      response,
      workspaceKey,
      ...(cwd ? { cwd } : {}),
      timeoutMs: config.agent.interactionTimeoutMs,
      botEvents,
    });

    const result = await runCopilot(buildInteractiveJob(turn), resolved.resolvedCwd, env, {
      ...runOptions,
      copilot: {
        ...runOptions.copilot,
        onPermissionRequest: async (
          request: CopilotPermissionRequest,
          invocation: CopilotPermissionInvocation,
        ) => {
          await queueSnapshotFlush();
          return await onPermissionRequest(request, invocation);
        },
        onUserInputRequest: async (
          request: CopilotUserInputRequest,
          invocation: CopilotUserInputInvocation,
        ) => {
          await queueSnapshotFlush();
          return await onUserInputRequest(request, invocation);
        },
      },
      onEvent: async (event) => {
        const summary = summarizeCopilotEvent(
          event as Parameters<typeof summarizeCopilotEvent>[0],
        );
        if (summary) {
          if (summary.isError) {
            logger.error({ sessionId }, summary.text);
          } else {
            logger.info({ sessionId }, summary.text);
          }
        }

        if (
          event &&
          typeof event === 'object' &&
          (event as { type?: unknown }).type === 'assistant.message_delta'
        ) {
          const deltaContent = (event as { data?: { deltaContent?: unknown } }).data?.deltaContent;
          if (typeof deltaContent === 'string' && deltaContent) {
            latestAssistantText += deltaContent;
            sawMessageDelta = true;
            scheduleSnapshotFlush();
          }
          return;
        }

        if (
          event &&
          typeof event === 'object' &&
          (event as { type?: unknown }).type === 'assistant.message'
        ) {
          const content = (event as { data?: { content?: unknown } }).data?.content;
          if (typeof content === 'string' && content) {
            latestAssistantText = content;
          }
        }
      },
    });

    if (scheduledSnapshot) {
      clearTimeout(scheduledSnapshot);
      scheduledSnapshot = undefined;
    }
    await queueSnapshotFlush();

    if (!sawMessageDelta && result.finalResponse) {
      outputBuffer.push(result.finalResponse);
      await outputBuffer.flush();
    }

    if (result.threadId) {
      await updateAgentSessionCodingAgentSessionId(sessionId, result.threadId).catch((err) => {
        logger.warn(
          { err, sessionId, codingAgentSessionId: result.threadId },
          'Failed to store Copilot session id',
        );
      });
    }

    await updateAgentSessionStatus(sessionId, 'completed').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session completed');
    });
  } catch (err) {
    logger.error(
      { err, sessionId, workspaceKey, profileKey: profile.key },
      'Copilot agent session prompt failed',
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
    await clearBrokeredCopilotInteractions({ sessionId, botEvents });
    outputBuffer.close();
  }
}

export async function steerCopilotAgentTurn(
  _input: SteerInteractiveAgentTurnInput,
): Promise<void> {
  throw unsupportedSteerError();
}

export async function stopCopilotAgentPrompt({
  event,
  notifier,
}: StopInteractiveAgentPromptInput): Promise<void> {
  await notifier.postMessage(buildRef(event.payload.response), unsupportedStopMessage());
}

export async function resolveCopilotAgentInteraction({
  event,
  notifier,
  botEvents,
}: ResolveInteractiveAgentInteractionInput): Promise<void> {
  await resolveBrokeredCopilotInteraction({
    event,
    notifier,
    botEvents,
  });
}
