import type {
  AgentSessionRecord,
  AgentSessionStatus,
} from '@sniptail/core/agent-sessions/types.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerAgentInteractionResolution,
  type WorkerAgentSessionStartPayload,
  type WorkerEvent,
  type WorkerReplyTarget,
} from '@sniptail/core/types/worker-event.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';

type AgentActorContext = {
  userId: string;
  workspaceId?: string;
  guildId?: string;
};

export function validateAgentSessionForThread(input: {
  session: AgentSessionRecord | undefined;
  threadId: string;
  allowedStatuses: AgentSessionStatus[];
  wrongThreadMessage: string;
}): string | undefined {
  if (!input.session) {
    return 'Agent session not found.';
  }
  if (input.session.threadId !== input.threadId) {
    return input.wrongThreadMessage;
  }
  if (!input.allowedStatuses.includes(input.session.status)) {
    return `This agent session is ${input.session.status}.`;
  }
  return undefined;
}

export function resolveAgentFollowUpMode(
  status: AgentSessionStatus,
  requested: 'queue' | 'steer',
): 'run' | 'queue' | 'steer' {
  return status === 'active' ? requested : 'run';
}

export function buildAgentReplyTarget(
  session: AgentSessionRecord,
  actor: AgentActorContext,
): WorkerReplyTarget {
  if (session.provider === 'discord') {
    return {
      provider: 'discord',
      channelId: session.threadId,
      threadId: session.threadId,
      userId: actor.userId,
      workspaceId: session.workspaceKey,
      ...((actor.guildId ?? session.guildId) ? { guildId: actor.guildId ?? session.guildId } : {}),
    };
  }

  return {
    provider: session.provider,
    channelId: session.channelId,
    threadId: session.threadId,
    userId: actor.userId,
    ...((actor.workspaceId ?? session.workspaceId)
      ? { workspaceId: actor.workspaceId ?? session.workspaceId }
      : {}),
    ...((actor.guildId ?? session.guildId) ? { guildId: actor.guildId ?? session.guildId } : {}),
  };
}

export function buildAgentSessionMessageWorkerEvent(input: {
  session: AgentSessionRecord;
  actor: AgentActorContext;
  message: string;
  messageId?: string;
  mode?: 'run' | 'queue' | 'steer';
}): WorkerEvent {
  return {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.session.message',
    payload: {
      sessionId: input.session.sessionId,
      response: buildAgentReplyTarget(input.session, input.actor),
      message: input.message,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    },
  };
}

export function buildAgentSessionStartWorkerEvent(input: {
  session: Pick<
    AgentSessionRecord,
    | 'sessionId'
    | 'provider'
    | 'channelId'
    | 'threadId'
    | 'userId'
    | 'workspaceId'
    | 'guildId'
    | 'workspaceKey'
    | 'agentProfileKey'
    | 'cwd'
  >;
  prompt: string;
  contextFiles?: JobContextFile[];
}): WorkerEvent {
  const response: WorkerAgentSessionStartPayload['response'] =
    input.session.provider === 'discord'
      ? {
          provider: 'discord',
          channelId: input.session.threadId,
          threadId: input.session.threadId,
          userId: input.session.userId,
          workspaceId: input.session.workspaceKey,
          ...(input.session.guildId ? { guildId: input.session.guildId } : {}),
        }
      : {
          provider: input.session.provider,
          channelId: input.session.channelId,
          threadId: input.session.threadId,
          userId: input.session.userId,
          ...(input.session.workspaceId ? { workspaceId: input.session.workspaceId } : {}),
          ...(input.session.guildId ? { guildId: input.session.guildId } : {}),
        };

  return {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.session.start',
    payload: {
      sessionId: input.session.sessionId,
      response,
      prompt: input.prompt,
      workspaceKey: input.session.workspaceKey,
      agentProfileKey: input.session.agentProfileKey,
      ...(input.session.cwd ? { cwd: input.session.cwd } : {}),
      ...(input.contextFiles?.length ? { contextFiles: input.contextFiles } : {}),
    },
  };
}

export function buildAgentPromptStopWorkerEvent(input: {
  session: AgentSessionRecord;
  actor: AgentActorContext;
  reason?: string;
  messageId?: string;
}): WorkerEvent {
  return {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.prompt.stop',
    payload: {
      sessionId: input.session.sessionId,
      response: buildAgentReplyTarget(input.session, input.actor),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
    },
  };
}

export function buildAgentInteractionResolveWorkerEvent(input: {
  session: AgentSessionRecord;
  actor: AgentActorContext;
  interactionId: string;
  resolution: WorkerAgentInteractionResolution;
}): WorkerEvent {
  return {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: input.session.sessionId,
      response: buildAgentReplyTarget(input.session, input.actor),
      interactionId: input.interactionId,
      resolution: input.resolution,
    },
  };
}
