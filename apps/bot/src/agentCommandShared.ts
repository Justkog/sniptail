import type {
  AgentSessionRecord,
  AgentSessionStatus,
} from '@sniptail/core/agent-sessions/types.js';
import { updateAgentSessionOwnership } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerMailboxEvent } from '@sniptail/core/queue/queue.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerAgentInteractionResolution,
  type WorkerAgentSessionStartPayload,
  type WorkerEvent,
  type WorkerReplyTarget,
} from '@sniptail/core/types/worker-event.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import { loadAgentCommandMetadata } from './agentCommandMetadataCache.js';

type AgentActorContext = {
  userId: string;
  workspaceId?: string;
  guildId?: string;
};

type AgentSessionMailboxRoute =
  | {
      ok: true;
      session: AgentSessionRecord;
      targetWorkerId: string;
    }
  | {
      ok: false;
      session: AgentSessionRecord;
      errorMessage: string;
    };

function formatOwnerWorker(session: AgentSessionRecord): string {
  if (!session.ownerWorkerId) {
    return 'unknown';
  }
  return session.ownerWorkerLabel
    ? `${session.ownerWorkerLabel} (${session.ownerWorkerId})`
    : session.ownerWorkerId;
}

function buildMissingOwnerMessage(): string {
  return 'This agent session has no owner worker and cannot be controlled.';
}

function buildStaleOwnerMessage(session: AgentSessionRecord): string {
  return `This agent session is waiting for owner worker ${formatOwnerWorker(session)} to return.`;
}

function buildOwnershipUpdate(input: {
  ownerWorkerId: string | undefined;
  ownerWorkerLabel: string | undefined;
  workerClaimedAt: string | undefined;
  ownerStaleSince?: string | undefined;
}): Pick<
  AgentSessionRecord,
  'ownerWorkerId' | 'ownerWorkerLabel' | 'workerClaimedAt' | 'ownerStaleSince'
> {
  return {
    ...(input.ownerWorkerId ? { ownerWorkerId: input.ownerWorkerId } : {}),
    ...(input.ownerWorkerLabel ? { ownerWorkerLabel: input.ownerWorkerLabel } : {}),
    ...(input.workerClaimedAt ? { workerClaimedAt: input.workerClaimedAt } : {}),
    ...(input.ownerStaleSince ? { ownerStaleSince: input.ownerStaleSince } : {}),
  };
}

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

export function isOwnerRoutedAgentEvent(event: WorkerEvent): boolean {
  return (
    event.type === 'agent.session.message' ||
    event.type === 'agent.prompt.stop' ||
    event.type === 'agent.interaction.resolve'
  );
}

export function getAgentSessionIdFromWorkerEvent(event: WorkerEvent): string | undefined {
  switch (event.type) {
    case 'agent.session.start':
    case 'agent.session.message':
    case 'agent.prompt.stop':
    case 'agent.interaction.resolve':
      return event.payload.sessionId;
    default:
      return undefined;
  }
}

export async function resolveAgentSessionOwnerMailboxRoute(
  session: AgentSessionRecord,
): Promise<AgentSessionMailboxRoute> {
  if (!session.ownerWorkerId) {
    return {
      ok: false,
      session,
      errorMessage: buildMissingOwnerMessage(),
    };
  }

  const metadata = await loadAgentCommandMetadata({ forceRefresh: true });
  const liveOwner = metadata.aggregated.liveWorkers.find(
    (worker) => worker.workerId === session.ownerWorkerId,
  );

  if (!liveOwner) {
    if (!session.ownerStaleSince) {
      const ownerStaleSince = new Date().toISOString();
      const updated = (await updateAgentSessionOwnership(
        session.sessionId,
        buildOwnershipUpdate({
          ownerWorkerId: session.ownerWorkerId,
          ownerWorkerLabel: session.ownerWorkerLabel,
          workerClaimedAt: session.workerClaimedAt,
          ownerStaleSince,
        }),
      )) ?? {
        ...session,
        ownerStaleSince,
      };
      return {
        ok: false,
        session: updated,
        errorMessage: buildStaleOwnerMessage(updated),
      };
    }

    return {
      ok: false,
      session,
      errorMessage: buildStaleOwnerMessage(session),
    };
  }

  if (session.ownerStaleSince || session.ownerWorkerLabel !== liveOwner.workerLabel) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ownerStaleSince: _ownerStaleSince, ...sessionWithoutStaleOwner } = session;
    const updated = (await updateAgentSessionOwnership(
      session.sessionId,
      buildOwnershipUpdate({
        ownerWorkerId: session.ownerWorkerId,
        ownerWorkerLabel: liveOwner.workerLabel,
        workerClaimedAt: session.workerClaimedAt,
      }),
    )) ?? {
      ...sessionWithoutStaleOwner,
      ...(liveOwner.workerLabel ? { ownerWorkerLabel: liveOwner.workerLabel } : {}),
    };
    return {
      ok: true,
      session: updated,
      targetWorkerId: session.ownerWorkerId,
    };
  }

  return {
    ok: true,
    session,
    targetWorkerId: session.ownerWorkerId,
  };
}

export async function enqueueAgentSessionOwnerMailboxEvent(input: {
  session: AgentSessionRecord;
  queueRuntime: Pick<QueueTransportRuntime, 'publishWorkerEventToMailbox'>;
  event: WorkerEvent;
}): Promise<AgentSessionRecord> {
  const route = await resolveAgentSessionOwnerMailboxRoute(input.session);
  if (!route.ok) {
    throw new Error(route.errorMessage);
  }
  await enqueueWorkerMailboxEvent(input.queueRuntime, route.targetWorkerId, input.event);
  return route.session;
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
