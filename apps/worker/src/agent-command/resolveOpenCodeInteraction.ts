import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import {
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
} from '@sniptail/core/opencode/opencode.js';
import { BOT_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import {
  getActiveOpenCodeRuntime,
  getPendingOpenCodeInteraction,
  takePendingOpenCodePermission,
} from './activeOpenCodeRuntimes.js';

export type ResolveAgentInteractionOptions = {
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  config: WorkerConfig;
  notifier: Notifier;
  botEvents: BotEventSink;
  env?: NodeJS.ProcessEnv;
};

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

function permissionStatus(decision: 'once' | 'always' | 'reject') {
  switch (decision) {
    case 'once':
      return 'approved_once' as const;
    case 'always':
      return 'approved_always' as const;
    case 'reject':
      return 'rejected' as const;
  }
}

async function publishPermissionUpdated(input: {
  botEvents: BotEventSink;
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  status: 'approved_once' | 'approved_always' | 'rejected' | 'failed';
  message?: string;
}) {
  const { response, sessionId, interactionId } = input.event.payload;
  await input.botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.permission.updated',
    payload: {
      channelId: response.threadId ?? response.channelId,
      threadId: response.threadId ?? response.channelId,
      sessionId,
      interactionId,
      status: input.status,
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

async function publishQuestionUpdated(input: {
  botEvents: BotEventSink;
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  status: 'answered' | 'rejected' | 'failed';
  message?: string;
}) {
  const { response, sessionId, interactionId } = input.event.payload;
  await input.botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.question.updated',
    payload: {
      channelId: response.threadId ?? response.channelId,
      threadId: response.threadId ?? response.channelId,
      sessionId,
      interactionId,
      status: input.status,
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

export async function resolveAgentInteraction({
  event,
  config,
  notifier,
  botEvents,
  env = process.env,
}: ResolveAgentInteractionOptions): Promise<void> {
  const { sessionId, interactionId, response, resolution } = event.payload;
  const ref = {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };

  if (!config.agent.enabled) {
    logger.warn(
      { sessionId, interactionId, threadId: response.threadId, userId: response.userId },
      'Ignoring agent interaction resolution because agent command is disabled in worker config',
    );
    return;
  }

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
  const pending = takePendingOpenCodePermission(sessionId, interactionId);
  if (!pending) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }

  try {
    if (resolution.kind === 'permission') {
      await replyOpenCodePermission(pending.directory, env, {
        ...buildOpenCodePermissionReplyOptions(config, pending.baseUrl || activeRuntime.baseUrl),
        requestID: pending.requestId,
        ...(pending.workspace ? { workspace: pending.workspace } : {}),
        reply: resolution.decision,
        ...(resolution.message ? { message: resolution.message } : {}),
      });
      await publishPermissionUpdated({
        botEvents,
        event,
        status: permissionStatus(resolution.decision),
        ...(resolution.message ? { message: resolution.message } : {}),
      });
      return;
    }

    if (resolution.reject) {
      await rejectOpenCodeQuestion(pending.directory, env, {
        ...buildOpenCodeQuestionOptions(config, pending.baseUrl || activeRuntime.baseUrl),
        requestID: pending.requestId,
        ...(pending.workspace ? { workspace: pending.workspace } : {}),
      });
      await publishQuestionUpdated({
        botEvents,
        event,
        status: 'rejected',
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
      event,
      status: 'answered',
      ...(resolution.message ? { message: resolution.message } : {}),
    });
  } catch (err) {
    logger.error(
      { err, sessionId, interactionId, kind: resolution.kind },
      'Failed to resolve OpenCode interaction',
    );
    if (resolution.kind === 'permission') {
      await publishPermissionUpdated({
        botEvents,
        event,
        status: 'failed',
        message: `Failed to resolve permission request: ${(err as Error).message}`,
      });
      await notifier.postMessage(
        ref,
        `Failed to resolve OpenCode permission request: ${(err as Error).message}`,
      );
      return;
    }
    await publishQuestionUpdated({
      botEvents,
      event,
      status: 'failed',
      message: `Failed to resolve question request: ${(err as Error).message}`,
    });
    await notifier.postMessage(
      ref,
      `Failed to resolve OpenCode question request: ${(err as Error).message}`,
    );
  }
}
