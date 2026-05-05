import { randomUUID } from 'node:crypto';
import {
  loadAgentSession,
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import {
  abortOpenCodeSession,
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
  runOpenCodePrompt,
} from '@sniptail/core/opencode/prompt.js';
import { summarizeOpenCodeEvent } from '@sniptail/core/opencode/logging.js';
import { BOT_EVENT_SCHEMA_VERSION, type BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
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
import {
  clearPendingOpenCodePermissionsForSession,
  deleteActiveOpenCodeRuntime,
  getActiveOpenCodeRuntime,
  getPendingOpenCodeInteraction,
  hasScheduledOpenCodePermissionPromotion,
  hasVisibleOpenCodePermission,
  markPendingOpenCodePermissionReplySent,
  markPendingOpenCodePermissionVisible,
  promoteNextQueuedOpenCodePermission,
  scheduleOpenCodePermissionPromotion,
  setActiveOpenCodeRuntime,
  setPendingOpenCodePermission,
  takePendingOpenCodePermission,
  takePendingOpenCodePermissionByRequestId,
  type PendingOpenCodePermission,
} from './openCodeInteractionState.js';
import { resolveAgentWorkspace } from '../agent-command/workspaceResolver.js';

const ALWAYS_PERMISSION_PROMOTION_DELAY_MS = 750;

type OpenCodePermissionAskedEvent = {
  type: 'permission.asked';
  properties: {
    id: string;
    sessionID: string;
    permission: string;
    patterns?: string[];
    metadata?: Record<string, unknown>;
  };
};

type OpenCodePermissionRepliedEvent = {
  type: 'permission.replied';
  properties: {
    sessionID: string;
    requestID: string;
    reply: 'once' | 'always' | 'reject';
  };
};

type OpenCodeQuestionAskedEvent = {
  type: 'question.asked';
  properties: {
    id: string;
    sessionID: string;
    questions: Array<{
      question: string;
      header: string;
      options: Array<{
        label: string;
        description?: string;
      }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
  };
};

function buildRef(response: CoreWorkerEvent<'agent.session.start'>['payload']['response']) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

function buildOpenCodeRunOptions(
  config: WorkerConfig,
  profile: RunInteractiveAgentTurnInput['turn']['profile'],
) {
  const model = profile.model ?? config.opencode.defaultModel?.model;
  const modelProvider = profile.modelProvider ?? config.opencode.defaultModel?.provider;
  const variant = profile.reasoningEffort;

  return {
    botName: config.botName,
    ...(model && modelProvider ? { model, modelProvider } : {}),
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
      ...(profile.name ? { agent: profile.name } : {}),
      ...(variant ? { variant } : {}),
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

function buildOpenCodePermissionReplyOptions(config: WorkerConfig, baseUrl: string) {
  return buildOpenCodeAbortOptions(config, baseUrl);
}

function buildOpenCodeQuestionOptions(config: WorkerConfig, baseUrl: string) {
  return buildOpenCodeAbortOptions(config, baseUrl);
}

function summarizeEvent(event: unknown): { text: string; isError: boolean } | null {
  return summarizeOpenCodeEvent(event as Parameters<typeof summarizeOpenCodeEvent>[0]);
}

function formatFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `OpenCode agent session failed: ${message}`;
}

function formatStopFailure(err: unknown): string {
  const message = (err as Error).message || String(err);
  return `Failed to stop OpenCode prompt: ${message}`;
}

async function isSessionStopped(sessionId: string): Promise<boolean> {
  const session = await loadAgentSession(sessionId).catch((err) => {
    logger.warn({ err, sessionId }, 'Failed to load agent session status');
    return undefined;
  });
  return session?.status === 'stopped';
}

function isOpenCodePermissionAskedEvent(event: unknown): event is OpenCodePermissionAskedEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as { type?: unknown; properties?: unknown };
  if (candidate.type !== 'permission.asked') return false;
  const properties = candidate.properties;
  if (!properties || typeof properties !== 'object') return false;
  const typed = properties as { id?: unknown; sessionID?: unknown; permission?: unknown };
  return (
    typeof typed.id === 'string' &&
    typeof typed.sessionID === 'string' &&
    typeof typed.permission === 'string'
  );
}

function isOpenCodeQuestionAskedEvent(event: unknown): event is OpenCodeQuestionAskedEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as { type?: unknown; properties?: unknown };
  if (candidate.type !== 'question.asked') return false;
  const properties = candidate.properties;
  if (!properties || typeof properties !== 'object') return false;
  const typed = properties as { id?: unknown; sessionID?: unknown; questions?: unknown };
  return (
    typeof typed.id === 'string' &&
    typeof typed.sessionID === 'string' &&
    Array.isArray(typed.questions)
  );
}

function isOpenCodePermissionRepliedEvent(event: unknown): event is OpenCodePermissionRepliedEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as { type?: unknown; properties?: unknown };
  if (candidate.type !== 'permission.replied') return false;
  const properties = candidate.properties;
  if (!properties || typeof properties !== 'object') return false;
  const typed = properties as { sessionID?: unknown; requestID?: unknown; reply?: unknown };
  return (
    typeof typed.sessionID === 'string' &&
    typeof typed.requestID === 'string' &&
    (typed.reply === 'once' || typed.reply === 'always' || typed.reply === 'reject')
  );
}

function getOpenCodeEventType(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const type = (event as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function summarizePermissionMetadata(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return [];
  return Object.entries(metadata)
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
}

function buildPermissionRequestEvent(input: {
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  permission: OpenCodePermissionAskedEvent['properties'];
  expiresAt: string;
}): BotEvent {
  const patterns = input.permission.patterns ?? [];
  const details = [
    ...patterns.map((pattern) => `Pattern: ${pattern}`),
    ...summarizePermissionMetadata(input.permission.metadata),
  ];
  return {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.permission.requested',
    payload: {
      channelId: input.response.threadId ?? input.response.channelId,
      threadId: input.response.threadId ?? input.response.channelId,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      toolName: input.permission.permission,
      ...(patterns.length ? { action: patterns.join(', ') } : {}),
      ...(details.length ? { details } : {}),
      expiresAt: input.expiresAt,
      allowAlways: true,
    },
  };
}

function buildQuestionRequestEvent(input: {
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  question: OpenCodeQuestionAskedEvent['properties'];
  expiresAt: string;
}): BotEvent {
  return {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.question.requested',
    payload: {
      channelId: input.response.threadId ?? input.response.channelId,
      threadId: input.response.threadId ?? input.response.channelId,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      questions: input.question.questions.map((question) => ({
        header: question.header,
        question: question.question,
        options: question.options.map((option) => ({
          label: option.label,
          ...(option.description ? { description: option.description } : {}),
        })),
        multiple: question.multiple ?? false,
        custom: question.custom ?? true,
      })),
      expiresAt: input.expiresAt,
    },
  };
}

function questionRequestDiscordLimitIssue(
  question: OpenCodeQuestionAskedEvent['properties'],
): string | undefined {
  if (question.questions.length === 0) {
    return 'OpenCode question request did not include any questions.';
  }
  if (question.questions.length > 5) {
    return 'OpenCode question request has more questions than Discord modals can support.';
  }
  if (
    question.questions.slice(4).some((entry) => entry.options.length > 0 && entry.custom === false)
  ) {
    return 'OpenCode question request has too many non-custom choice questions for Discord controls.';
  }
  return undefined;
}

async function publishPermissionUpdated(input: {
  botEvents: BotEventSink;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  sessionId: string;
  interactionId: string;
  status: 'approved_once' | 'approved_always' | 'rejected' | 'expired' | 'failed';
  message?: string;
}) {
  await input.botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.permission.updated',
    payload: {
      channelId: input.response.threadId ?? input.response.channelId,
      threadId: input.response.threadId ?? input.response.channelId,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: input.status,
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

async function publishQuestionUpdated(input: {
  botEvents: BotEventSink;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  sessionId: string;
  interactionId: string;
  status: 'answered' | 'rejected' | 'expired' | 'failed';
  actorUserId?: string;
  message?: string;
}) {
  await input.botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.question.updated',
    payload: {
      channelId: input.response.threadId ?? input.response.channelId,
      threadId: input.response.threadId ?? input.response.channelId,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: input.status,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

function permissionReplyStatus(reply: 'once' | 'always' | 'reject') {
  switch (reply) {
    case 'once':
      return 'approved_once' as const;
    case 'always':
      return 'approved_always' as const;
    case 'reject':
      return 'rejected' as const;
  }
}

async function publishPromotedPermission(input: {
  botEvents: BotEventSink;
  permission: PendingOpenCodePermission | undefined;
}) {
  if (!input.permission) return;
  await input.botEvents.publish(input.permission.requestEvent);
}

async function promoteNextPermission(input: { sessionId: string; botEvents: BotEventSink }) {
  await publishPromotedPermission({
    botEvents: input.botEvents,
    permission: promoteNextQueuedOpenCodePermission(input.sessionId),
  });
}

function scheduleAlwaysPermissionPromotion(input: { sessionId: string; botEvents: BotEventSink }) {
  const replacingExistingTimer = hasScheduledOpenCodePermissionPromotion(input.sessionId);
  scheduleOpenCodePermissionPromotion(input.sessionId, ALWAYS_PERMISSION_PROMOTION_DELAY_MS, () => {
    const promoted = promoteNextQueuedOpenCodePermission(input.sessionId);
    logger.info(
      {
        sessionId: input.sessionId,
        promotedInteractionId: promoted?.interactionId,
        promotedRequestId: promoted?.requestId,
        promotedDisplayState: promoted?.displayState,
      },
      'Deferred Discord permission display queue promotion fired after always reply',
    );
    void publishPromotedPermission({ botEvents: input.botEvents, permission: promoted });
  });
  logger.info(
    {
      sessionId: input.sessionId,
      delayMs: ALWAYS_PERMISSION_PROMOTION_DELAY_MS,
      replacingExistingTimer,
    },
    'Scheduled deferred Discord permission display queue promotion after always reply',
  );
}

async function rejectOpenCodePermissionOnTimeout(input: {
  sessionId: string;
  interactionId: string;
  config: WorkerConfig;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
}) {
  const pending = takePendingOpenCodePermission(input.sessionId, input.interactionId);
  if (!pending || pending.kind !== 'permission') return;
  const wasDisplayed = pending.displayState === 'visible' || pending.displayState === 'reply_sent';
  try {
    await replyOpenCodePermission(pending.directory, input.env, {
      ...buildOpenCodePermissionReplyOptions(input.config, pending.baseUrl),
      requestID: pending.requestId,
      ...(pending.workspace ? { workspace: pending.workspace } : {}),
      reply: 'reject',
      message: 'Permission request expired in Discord.',
    });
    if (wasDisplayed) {
      await publishPermissionUpdated({
        botEvents: input.botEvents,
        response: input.response,
        sessionId: input.sessionId,
        interactionId: input.interactionId,
        status: 'expired',
        message: 'Permission request expired and was rejected.',
      });
    }
  } catch (err) {
    logger.error(
      { err, sessionId: input.sessionId, interactionId: input.interactionId },
      'Failed to reject expired OpenCode permission request',
    );
    if (wasDisplayed) {
      await publishPermissionUpdated({
        botEvents: input.botEvents,
        response: input.response,
        sessionId: input.sessionId,
        interactionId: input.interactionId,
        status: 'failed',
        message: `Permission request expired, but rejecting it failed: ${(err as Error).message}`,
      });
    }
  } finally {
    await promoteNextPermission({ sessionId: input.sessionId, botEvents: input.botEvents });
  }
}

async function rejectOpenCodeQuestionOnTimeout(input: {
  sessionId: string;
  interactionId: string;
  config: WorkerConfig;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
}) {
  const pending = takePendingOpenCodePermission(input.sessionId, input.interactionId);
  if (!pending || pending.kind !== 'question') return;
  try {
    await rejectOpenCodeQuestion(pending.directory, input.env, {
      ...buildOpenCodeQuestionOptions(input.config, pending.baseUrl),
      requestID: pending.requestId,
      ...(pending.workspace ? { workspace: pending.workspace } : {}),
    });
    await publishQuestionUpdated({
      botEvents: input.botEvents,
      response: input.response,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: 'expired',
      message: 'Question request expired and was rejected.',
    });
  } catch (err) {
    logger.error(
      { err, sessionId: input.sessionId, interactionId: input.interactionId },
      'Failed to reject expired OpenCode question request',
    );
    await publishQuestionUpdated({
      botEvents: input.botEvents,
      response: input.response,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: 'failed',
      message: `Question request expired, but rejecting it failed: ${(err as Error).message}`,
    });
  }
}

async function rejectUnrenderableOpenCodeQuestion(input: {
  sessionId: string;
  interactionId: string;
  requestId: string;
  directory: string;
  baseUrl: string;
  config: WorkerConfig;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
  message: string;
}) {
  try {
    await rejectOpenCodeQuestion(input.directory, input.env, {
      ...buildOpenCodeQuestionOptions(input.config, input.baseUrl),
      requestID: input.requestId,
    });
  } catch (err) {
    logger.error(
      { err, sessionId: input.sessionId, interactionId: input.interactionId },
      'Failed to reject unrenderable OpenCode question request',
    );
  }
  await publishQuestionUpdated({
    botEvents: input.botEvents,
    response: input.response,
    sessionId: input.sessionId,
    interactionId: input.interactionId,
    status: 'failed',
    message: input.message,
  });
}

export async function runOpenCodeAgentTurn({
  turn,
  config,
  notifier,
  botEvents,
  env,
}: RunInteractiveAgentTurnInput): Promise<void> {
  const { sessionId, response, workspaceKey, profile, prompt, cwd, codingAgentSessionId } = turn;
  const ref = buildRef(response);
  const outputBuffer = createDebouncedAgentOutputBuffer({
    notifier,
    ref,
    debounceMs: config.agent.outputDebounceMs,
  });

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
        ...(profile.name ? { opencodeAgent: profile.name } : {}),
        ...(profile.model ? { opencodeModel: profile.model } : {}),
        ...(profile.reasoningEffort ? { opencodeVariant: profile.reasoningEffort } : {}),
        resolvedCwd: resolved.resolvedCwd,
        promptLength: prompt.length,
      },
      'Starting OpenCode agent session prompt',
    );

    let activeRuntimeBaseUrl: string | undefined;
    let activeRuntimeDirectory = resolved.resolvedCwd;

    await runOpenCodePrompt(prompt, resolved.resolvedCwd, env, {
      ...buildOpenCodeRunOptions(config, profile),
      runtimeId: sessionId,
      ...(codingAgentSessionId ? { sessionId: codingAgentSessionId } : {}),
      onSessionId: async (nextCodingAgentSessionId) => {
        await updateAgentSessionCodingAgentSessionId(sessionId, nextCodingAgentSessionId).catch(
          (err) => {
            logger.warn(
              { err, sessionId, codingAgentSessionId: nextCodingAgentSessionId },
              'Failed to store OpenCode session id',
            );
          },
        );
      },
      onRuntimeReady: (runtime) => {
        activeRuntimeBaseUrl = runtime.baseUrl;
        activeRuntimeDirectory = runtime.directory;
        setActiveOpenCodeRuntime(sessionId, {
          codingAgentSessionId: runtime.sessionId,
          baseUrl: runtime.baseUrl,
          directory: runtime.directory,
          executionMode: runtime.executionMode,
        });
      },
      onEvent: async (opencodeEvent) => {
        const opencodeEventType = getOpenCodeEventType(opencodeEvent);
        if (opencodeEventType?.startsWith('permission.')) {
          logger.info(
            { sessionId, opencodeEvent },
            'OpenCode permission event received for agent session',
          );
        }
        if (isOpenCodePermissionAskedEvent(opencodeEvent)) {
          await outputBuffer.flush();
          const interactionId = randomUUID();
          const expiresAt = new Date(Date.now() + config.agent.interactionTimeoutMs).toISOString();
          const timeout = setTimeout(() => {
            void rejectOpenCodePermissionOnTimeout({
              sessionId,
              interactionId,
              config,
              response,
              botEvents,
              env,
            });
          }, config.agent.interactionTimeoutMs);
          const requestEvent = buildPermissionRequestEvent({
            response,
            sessionId,
            interactionId,
            workspaceKey,
            ...(cwd ? { cwd } : {}),
            permission: opencodeEvent.properties,
            expiresAt,
          });
          setPendingOpenCodePermission({
            sessionId,
            interactionId,
            kind: 'permission',
            displayState: 'queued',
            requestId: opencodeEvent.properties.id,
            baseUrl:
              activeRuntimeBaseUrl ??
              (config.opencode.executionMode === 'server'
                ? config.opencode.serverUrl
                : undefined) ??
              '',
            directory: activeRuntimeDirectory,
            expiresAt,
            timeout,
            requestEvent,
          });
          if (!hasVisibleOpenCodePermission(sessionId)) {
            await publishPromotedPermission({
              botEvents,
              permission: markPendingOpenCodePermissionVisible(sessionId, interactionId),
            });
          }
        }
        if (isOpenCodePermissionRepliedEvent(opencodeEvent)) {
          const pending = takePendingOpenCodePermissionByRequestId(
            opencodeEvent.properties.requestID,
          );
          if (pending) {
            if (pending.displayState === 'visible' || pending.displayState === 'reply_sent') {
              await publishPermissionUpdated({
                botEvents,
                response,
                sessionId,
                interactionId: pending.interactionId,
                status: permissionReplyStatus(opencodeEvent.properties.reply),
              });
            }
            if (opencodeEvent.properties.reply === 'always') {
              scheduleAlwaysPermissionPromotion({ sessionId, botEvents });
            } else {
              await publishPromotedPermission({
                botEvents,
                permission: promoteNextQueuedOpenCodePermission(sessionId),
              });
            }
          }
        }
        if (isOpenCodeQuestionAskedEvent(opencodeEvent)) {
          await outputBuffer.flush();
          const interactionId = randomUUID();
          const baseUrl =
            activeRuntimeBaseUrl ??
            (config.opencode.executionMode === 'server' ? config.opencode.serverUrl : undefined) ??
            '';
          const limitIssue = questionRequestDiscordLimitIssue(opencodeEvent.properties);
          if (limitIssue) {
            await rejectUnrenderableOpenCodeQuestion({
              sessionId,
              interactionId,
              requestId: opencodeEvent.properties.id,
              directory: activeRuntimeDirectory,
              baseUrl,
              config,
              response,
              botEvents,
              env,
              message: limitIssue,
            });
            return;
          }
          const expiresAt = new Date(Date.now() + config.agent.interactionTimeoutMs).toISOString();
          const timeout = setTimeout(() => {
            void rejectOpenCodeQuestionOnTimeout({
              sessionId,
              interactionId,
              config,
              response,
              botEvents,
              env,
            });
          }, config.agent.interactionTimeoutMs);
          setPendingOpenCodePermission({
            sessionId,
            interactionId,
            kind: 'question',
            requestId: opencodeEvent.properties.id,
            baseUrl,
            directory: activeRuntimeDirectory,
            expiresAt,
            timeout,
          });
          await botEvents.publish(
            buildQuestionRequestEvent({
              response,
              sessionId,
              interactionId,
              workspaceKey,
              ...(cwd ? { cwd } : {}),
              question: opencodeEvent.properties,
              expiresAt,
            }),
          );
        }
        const summary = summarizeEvent(opencodeEvent);
        if (!summary) return;
        if (summary.isError) {
          logger.error({ sessionId }, summary.text);
        } else {
          logger.info({ sessionId }, summary.text);
        }
      },
      onAssistantMessage: (text) => {
        outputBuffer.push(text);
      },
    });

    await outputBuffer.flush();
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
        'OpenCode agent prompt aborted for steer follow-up',
      );
      await outputBuffer.flush();
      return;
    }
    logger.error(
      { err, sessionId, workspaceKey, profileKey: profile.key },
      'OpenCode agent session prompt failed',
    );
    if (await isSessionStopped(sessionId)) {
      await outputBuffer.flush();
      return;
    }
    await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
      logger.warn({ err: updateErr, sessionId }, 'Failed to mark agent session failed');
    });
    await outputBuffer.flush();
    await notifier.postMessage(ref, formatFailure(err));
  } finally {
    clearPendingOpenCodePermissionsForSession(sessionId);
    deleteActiveOpenCodeRuntime(sessionId);
    outputBuffer.close();
  }
}

export async function steerOpenCodeAgentTurn({
  sessionId,
  config,
  env,
}: SteerInteractiveAgentTurnInput): Promise<void> {
  const activeRuntime = getActiveOpenCodeRuntime(sessionId);
  if (!activeRuntime) {
    throw new Error('active runtime is no longer reachable.');
  }
  try {
    await abortOpenCodeSession(
      activeRuntime.codingAgentSessionId,
      activeRuntime.directory,
      env,
      buildOpenCodeAbortOptions(config, activeRuntime.baseUrl),
    );
  } catch (err) {
    cancelAgentFollowUpSteer(sessionId);
    throw err;
  }
}

export async function stopOpenCodeAgentPrompt({
  event,
  session,
  config,
  notifier,
  env,
}: StopInteractiveAgentPromptInput): Promise<void> {
  const { sessionId, response } = event.payload;
  const ref = buildRef(response);

  try {
    const activeRuntime = getActiveOpenCodeRuntime(sessionId);
    const codingAgentSessionId =
      activeRuntime?.codingAgentSessionId ?? session.codingAgentSessionId;
    if (!codingAgentSessionId) {
      await notifier.postMessage(ref, 'OpenCode prompt cannot be stopped yet: session is starting.');
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
    clearAgentPromptTurn(sessionId);
    await updateAgentSessionStatus(sessionId, 'stopped').catch((err) => {
      logger.warn({ err, sessionId }, 'Failed to mark agent session stopped');
    });
    await notifier.postMessage(ref, 'OpenCode prompt stopped.');
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to stop OpenCode agent prompt');
    await notifier.postMessage(ref, formatStopFailure(err));
  }
}

export async function resolveOpenCodeAgentInteraction({
  event,
  config,
  notifier,
  botEvents,
  env,
}: ResolveInteractiveAgentInteractionInput): Promise<void> {
  const { sessionId, interactionId, response, resolution } = event.payload;
  const ref = buildRef(response);

  const activeRuntime = getActiveOpenCodeRuntime(sessionId);
  if (!activeRuntime) {
    await notifier.postMessage(
      ref,
      'OpenCode permission request cannot be resolved: active runtime is no longer reachable.',
    );
    return;
  }

  const pendingPreview = getPendingOpenCodeInteraction(sessionId, interactionId);
  if (!pendingPreview) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }
  if (pendingPreview.kind !== resolution.kind) {
    await notifier.postMessage(
      ref,
      'This agent interaction no longer matches the selected control.',
    );
    return;
  }
  if (
    resolution.kind === 'permission' &&
    pendingPreview.kind === 'permission' &&
    pendingPreview.displayState === 'reply_sent'
  ) {
    await notifier.postMessage(ref, 'This agent permission is already being resolved.');
    return;
  }
  if (
    resolution.kind === 'permission' &&
    pendingPreview.kind === 'permission' &&
    pendingPreview.displayState !== 'visible'
  ) {
    await notifier.postMessage(ref, 'This agent permission is not currently displayed.');
    return;
  }
  if (resolution.kind === 'permission') {
    try {
      await replyOpenCodePermission(pendingPreview.directory, env, {
        ...buildOpenCodePermissionReplyOptions(
          config,
          pendingPreview.baseUrl || activeRuntime.baseUrl,
        ),
        requestID: pendingPreview.requestId,
        ...(pendingPreview.workspace ? { workspace: pendingPreview.workspace } : {}),
        reply: resolution.decision,
        ...(resolution.message ? { message: resolution.message } : {}),
      });
      markPendingOpenCodePermissionReplySent(sessionId, interactionId);
      return;
    } catch (err) {
      logger.error(
        { err, sessionId, interactionId, kind: resolution.kind },
        'Failed to resolve OpenCode interaction',
      );
      takePendingOpenCodePermission(sessionId, interactionId);
      await botEvents.publish({
        schemaVersion: BOT_EVENT_SCHEMA_VERSION,
        provider: 'discord',
        type: 'agent.permission.updated',
        payload: {
          channelId: response.threadId ?? response.channelId,
          threadId: response.threadId ?? response.channelId,
          sessionId,
          interactionId,
          status: 'failed',
          ...(response.userId ? { actorUserId: response.userId } : {}),
          message: `Failed to resolve permission request: ${(err as Error).message}`,
        },
      });
      await publishPromotedPermission({
        botEvents,
        permission: promoteNextQueuedOpenCodePermission(sessionId),
      });
      await notifier.postMessage(
        ref,
        `Failed to resolve OpenCode permission request: ${(err as Error).message}`,
      );
      return;
    }
  }

  const pending = takePendingOpenCodePermission(sessionId, interactionId);
  if (!pending) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }

  try {
    if (resolution.reject) {
      await rejectOpenCodeQuestion(pending.directory, env, {
        ...buildOpenCodeQuestionOptions(config, pending.baseUrl || activeRuntime.baseUrl),
        requestID: pending.requestId,
        ...(pending.workspace ? { workspace: pending.workspace } : {}),
      });
      await publishQuestionUpdated({
        botEvents,
        response,
        sessionId,
        interactionId,
        status: 'rejected',
        ...(response.userId ? { actorUserId: response.userId } : {}),
        ...(resolution.message ? { message: resolution.message } : {}),
      });
      return;
    }

    await replyOpenCodeQuestion(pending.directory, env, {
      ...buildOpenCodeQuestionOptions(config, pending.baseUrl || activeRuntime.baseUrl),
      requestID: pending.requestId,
      ...(pending.workspace ? { workspace: pending.workspace } : {}),
      answers: resolution.answers ?? [],
    });
    await publishQuestionUpdated({
      botEvents,
      response,
      sessionId,
      interactionId,
      status: 'answered',
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(resolution.message ? { message: resolution.message } : {}),
    });
  } catch (err) {
    logger.error({ err, sessionId, interactionId }, 'Failed to resolve OpenCode question');
    await publishQuestionUpdated({
      botEvents,
      response,
      sessionId,
      interactionId,
      status: 'failed',
      message: `Failed to resolve question: ${(err as Error).message}`,
    });
    await notifier.postMessage(
      ref,
      `Failed to resolve OpenCode question: ${(err as Error).message}`,
    );
  }
}
