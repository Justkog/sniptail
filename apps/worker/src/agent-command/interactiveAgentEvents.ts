import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import {
  BOT_EVENT_SCHEMA_VERSION,
  type BotAgentQuestion,
} from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';

type AgentResponse = CoreWorkerEvent<'agent.session.start'>['payload']['response'];

function buildThreadTarget(response: AgentResponse) {
  return {
    channelId: response.threadId ?? response.channelId,
    threadId: response.threadId ?? response.channelId,
  };
}

export function buildPermissionRequestEvent(input: {
  response: AgentResponse;
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  toolName?: string;
  action?: string;
  details?: string[];
  expiresAt: string;
  allowAlways: boolean;
}): BotEvent {
  return {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.permission.requested',
    payload: {
      ...buildThreadTarget(input.response),
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.details?.length ? { details: input.details } : {}),
      expiresAt: input.expiresAt,
      allowAlways: input.allowAlways,
    },
  };
}

export function buildQuestionRequestEvent(input: {
  response: AgentResponse;
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  questions: BotAgentQuestion[];
  expiresAt: string;
}): BotEvent {
  return {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.question.requested',
    payload: {
      ...buildThreadTarget(input.response),
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      questions: input.questions,
      expiresAt: input.expiresAt,
    },
  };
}

export async function publishPermissionUpdated(input: {
  botEvents: BotEventSink;
  response: AgentResponse;
  sessionId: string;
  interactionId: string;
  status: 'approved_once' | 'approved_always' | 'rejected' | 'expired' | 'failed';
  actorUserId?: string;
  message?: string;
}) {
  await input.botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.permission.updated',
    payload: {
      ...buildThreadTarget(input.response),
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: input.status,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

export async function publishQuestionUpdated(input: {
  botEvents: BotEventSink;
  response: AgentResponse;
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
      ...buildThreadTarget(input.response),
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      status: input.status,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.message ? { message: input.message } : {}),
    },
  });
}
