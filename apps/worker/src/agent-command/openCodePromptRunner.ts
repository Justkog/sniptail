import { randomUUID } from 'node:crypto';
import {
  abortOpenCodeSession,
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  runOpenCodePrompt,
} from '@sniptail/core/opencode/opencode.js';
import {
  loadAgentSession,
  updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import { BOT_EVENT_SCHEMA_VERSION, type BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import { summarizeOpenCodeEvent } from '@sniptail/core/opencode/logging.js';
import type { Notifier } from '../channels/notifier.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import {
  clearPendingOpenCodePermissionsForSession,
  deleteActiveOpenCodeRuntime,
  getActiveOpenCodeRuntime,
  hasVisibleOpenCodePermission,
  hasScheduledOpenCodePermissionPromotion,
  markPendingOpenCodePermissionVisible,
  promoteNextQueuedOpenCodePermission,
  scheduleOpenCodePermissionPromotion,
  setActiveOpenCodeRuntime,
  setPendingOpenCodePermission,
  takePendingOpenCodePermissionByRequestId,
  takePendingOpenCodePermission,
  type PendingOpenCodePermission,
} from './activeOpenCodeRuntimes.js';
import {
  beginOpenCodePromptTurn,
  cancelOpenCodeFollowUpSteer,
  clearOpenCodePromptTurn,
  enqueueOpenCodeFollowUp,
  finishOpenCodePromptTurn,
  isAbortingOpenCodePromptForSteer,
  isOpenCodePromptTurnActive,
  steerOpenCodeFollowUp,
  type QueuedOpenCodeFollowUp,
} from './activeOpenCodePromptTurns.js';
import { createDebouncedAgentOutputBuffer } from './debouncedAgentOutput.js';
import { resolveAgentWorkspace } from './workspaceResolver.js';

export type RunAgentSessionStartOptions = {
  event: CoreWorkerEvent<'agent.session.start'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

export type RunAgentSessionMessageOptions = {
  event: CoreWorkerEvent<'agent.session.message'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

const ALWAYS_PERMISSION_PROMOTION_DELAY_MS = 750;

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

async function isSessionStopped(sessionId: string): Promise<boolean> {
  const session = await loadAgentSession(sessionId).catch((err) => {
    logger.warn({ err, sessionId }, 'Failed to load agent session status');
    return undefined;
  });
  return session?.status === 'stopped';
}

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

async function publishQuestionUpdated(input: {
  botEvents: BotEventSink;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  sessionId: string;
  interactionId: string;
  status: 'expired' | 'failed';
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
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

function buildOpenCodePermissionReplyOptions(config: WorkerConfig, baseUrl: string) {
  return {
    baseUrl,
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
    },
  };
}

function buildOpenCodeQuestionOptions(config: WorkerConfig, baseUrl: string) {
  return {
    baseUrl,
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
    },
  };
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

type OpenCodeTurnInput = {
  sessionId: string;
  response: CoreWorkerEvent<'agent.session.start'>['payload']['response'];
  prompt: string;
  workspaceKey: string;
  agentProfileKey: string;
  cwd?: string;
  codingAgentSessionId?: string;
};

async function runOpenCodeTurn({
  turn,
  config,
  notifier,
  botEvents,
  env,
}: {
  turn: OpenCodeTurnInput;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const { sessionId, response, workspaceKey, agentProfileKey, prompt, cwd, codingAgentSessionId } =
    turn;
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

    let activeRuntimeBaseUrl: string | undefined;
    let activeRuntimeDirectory = resolved.resolvedCwd;

    const result = await runOpenCodePrompt(prompt, resolved.resolvedCwd, env, {
      ...buildOpenCodeRunOptions(config, profile.name),
      runtimeId: sessionId,
      ...(codingAgentSessionId ? { sessionId: codingAgentSessionId } : {}),
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
          logger.info(
            {
              sessionId,
              interactionId,
              requestId: opencodeEvent.properties.id,
              permission: opencodeEvent.properties.permission,
              visiblePermissionAlreadyPresent: hasVisibleOpenCodePermission(sessionId),
            },
            'Tracked OpenCode permission request',
          );
          if (!hasVisibleOpenCodePermission(sessionId)) {
            await publishPromotedPermission({
              botEvents,
              permission: markPendingOpenCodePermissionVisible(sessionId, interactionId),
            });
            logger.info(
              {
                sessionId,
                interactionId,
                requestId: opencodeEvent.properties.id,
                permission: opencodeEvent.properties.permission,
              },
              'Published visible Discord permission request',
            );
          } else {
            logger.info(
              {
                sessionId,
                interactionId,
                requestId: opencodeEvent.properties.id,
                permission: opencodeEvent.properties.permission,
              },
              'Queued hidden Discord permission request',
            );
          }
        }
        if (isOpenCodePermissionRepliedEvent(opencodeEvent)) {
          const pending = takePendingOpenCodePermissionByRequestId(
            opencodeEvent.properties.requestID,
          );
          logger.info(
            {
              sessionId,
              requestId: opencodeEvent.properties.requestID,
              reply: opencodeEvent.properties.reply,
              matchedPending: Boolean(pending),
              interactionId: pending?.interactionId,
              displayState: pending?.displayState,
            },
            'OpenCode permission reply matched pending request',
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
              const promoted = promoteNextQueuedOpenCodePermission(sessionId);
              logger.info(
                {
                  sessionId,
                  promotedInteractionId: promoted?.interactionId,
                  promotedRequestId: promoted?.requestId,
                  promotedDisplayState: promoted?.displayState,
                },
                'Advanced Discord permission display queue after OpenCode reply',
              );
              await publishPromotedPermission({ botEvents, permission: promoted });
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
    // await notifier.postMessage(ref, formatFinalResponse(result.finalResponse ?? ''));
  } catch (err) {
    if (isAbortingOpenCodePromptForSteer(sessionId)) {
      logger.info(
        { err, sessionId, workspaceKey, profileKey: agentProfileKey },
        'OpenCode agent prompt aborted for steer follow-up',
      );
      await outputBuffer.flush();
      return;
    }
    logger.error(
      { err, sessionId, workspaceKey, profileKey: agentProfileKey },
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

async function runOpenCodeTurnLoop(input: {
  initialTurn: OpenCodeTurnInput;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env: NodeJS.ProcessEnv;
}) {
  let nextTurn: OpenCodeTurnInput | undefined = input.initialTurn;
  while (nextTurn) {
    await runOpenCodeTurn({
      turn: nextTurn,
      config: input.config,
      notifier: input.notifier,
      botEvents: input.botEvents,
      env: input.env,
    });
    const queued = finishOpenCodePromptTurn(nextTurn.sessionId);
    if (!queued) {
      nextTurn = undefined;
      continue;
    }
    const session = await loadAgentSession(queued.sessionId);
    if (!session || session.status === 'stopped' || session.status === 'failed') {
      clearOpenCodePromptTurn(queued.sessionId);
      nextTurn = undefined;
      continue;
    }
    nextTurn = {
      sessionId: queued.sessionId,
      response: queued.response,
      prompt: queued.message,
      workspaceKey: session.workspaceKey,
      agentProfileKey: session.agentProfileKey,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.codingAgentSessionId
        ? { codingAgentSessionId: session.codingAgentSessionId }
        : {}),
    };
  }
}

export async function runAgentSessionStart({
  event,
  config,
  notifier,
  botEvents,
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
  if (!beginOpenCodePromptTurn(sessionId)) {
    await notifier.postMessage(
      {
        provider: response.provider,
        channelId: response.channelId,
        ...(response.threadId ? { threadId: response.threadId } : {}),
      },
      'This agent session already has an active prompt.',
    );
    return;
  }

  await runOpenCodeTurnLoop({
    initialTurn: {
      sessionId,
      response,
      prompt,
      workspaceKey,
      agentProfileKey,
      ...(cwd ? { cwd } : {}),
    },
    config,
    notifier,
    botEvents,
    env,
  });
}

export async function runAgentSessionMessage({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: RunAgentSessionMessageOptions): Promise<void> {
  const { sessionId, response, message, messageId, mode = 'run' } = event.payload;
  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent session message because agent command is disabled in worker config',
    );
    return;
  }

  const followUp: QueuedOpenCodeFollowUp = {
    sessionId,
    response,
    message,
    ...(messageId ? { messageId } : {}),
  };

  if (isOpenCodePromptTurnActive(sessionId)) {
    if (mode === 'queue') {
      enqueueOpenCodeFollowUp(followUp);
      await notifier.postMessage(ref, 'Follow-up queued for the next agent turn.');
      return;
    }
    if (mode === 'steer') {
      steerOpenCodeFollowUp(followUp);
      const activeRuntime = getActiveOpenCodeRuntime(sessionId);
      if (!activeRuntime) {
        cancelOpenCodeFollowUpSteer(sessionId);
        await notifier.postMessage(
          ref,
          'Cannot steer this prompt: active runtime is no longer reachable.',
        );
        return;
      }
      try {
        await abortOpenCodeSession(
          activeRuntime.codingAgentSessionId,
          activeRuntime.directory,
          env,
          buildOpenCodeAbortOptions(config, activeRuntime.baseUrl),
        );
        await notifier.postMessage(ref, 'Steering current prompt. Running this message next.');
      } catch (err) {
        cancelOpenCodeFollowUpSteer(sessionId);
        logger.error({ err, sessionId }, 'Failed to abort OpenCode prompt for steer follow-up');
        await notifier.postMessage(
          ref,
          `Failed to steer current prompt: ${(err as Error).message}`,
        );
      }
      return;
    }
    await notifier.postMessage(ref, 'This agent session already has an active prompt.');
    return;
  }

  const session = await loadAgentSession(sessionId);
  if (!session) {
    await notifier.postMessage(ref, 'Agent session not found.');
    return;
  }
  if (session.status === 'pending') {
    await notifier.postMessage(ref, 'This agent session is still waiting to start.');
    return;
  }
  if (session.status !== 'completed' && session.status !== 'active') {
    await notifier.postMessage(ref, `This agent session is ${session.status}.`);
    return;
  }
  if (!session.codingAgentSessionId) {
    await notifier.postMessage(ref, 'OpenCode session id is not available for this agent session.');
    return;
  }
  if (!beginOpenCodePromptTurn(sessionId)) {
    await notifier.postMessage(ref, 'This agent session already has an active prompt.');
    return;
  }

  await runOpenCodeTurnLoop({
    initialTurn: {
      sessionId,
      response,
      prompt: message,
      workspaceKey: session.workspaceKey,
      agentProfileKey: session.agentProfileKey,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      codingAgentSessionId: session.codingAgentSessionId,
    },
    config,
    notifier,
    botEvents,
    env,
  });
}
