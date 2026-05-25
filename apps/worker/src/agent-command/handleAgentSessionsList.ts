import { BOT_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import { logger } from '@sniptail/core/logger.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import { listAgentSessionsForWorker } from './agentSessionListService.js';

type AgentSessionsListEvent = CoreWorkerEvent<'agent.sessions.list'>;

function buildInvalidReplyTargetMessage(event: AgentSessionsListEvent): string {
  return `Cannot publish session list response for worker "${event.payload.workerId}" without a reply user id.`;
}

function toUserErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.';
}

export async function handleAgentSessionsList(input: {
  event: AgentSessionsListEvent;
  config: WorkerConfig;
  botEvents: BotEventSink;
}): Promise<void> {
  const { event, config, botEvents } = input;
  const { response } = event.payload;

  if (!response.userId) {
    logger.warn({ event }, buildInvalidReplyTargetMessage(event));
    return;
  }

  try {
    const result = await listAgentSessionsForWorker({
      config,
      payload: event.payload,
    });
    await botEvents.publish({
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: response.provider,
      ...(event.requestId ? { requestId: event.requestId } : {}),
      type: 'agent.sessions.listed',
      payload: {
        channelId: response.channelId,
        userId: response.userId,
        ...(response.workspaceId ? { workspaceId: response.workspaceId } : {}),
        ...(response.guildId ? { guildId: response.guildId } : {}),
        ...(event.payload.agentProfileKey
          ? { agentProfileKey: event.payload.agentProfileKey }
          : {}),
        workerId: event.payload.workerId,
        sessions: result.sessions,
        ...(result.previousCursor ? { previousCursor: result.previousCursor } : {}),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, event }, 'Failed to list agent sessions');
    await botEvents.publish({
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: response.provider,
      ...(event.requestId ? { requestId: event.requestId } : {}),
      type: 'agent.sessions.listed',
      payload: {
        channelId: response.channelId,
        userId: response.userId,
        ...(response.workspaceId ? { workspaceId: response.workspaceId } : {}),
        ...(response.guildId ? { guildId: response.guildId } : {}),
        ...(event.payload.agentProfileKey
          ? { agentProfileKey: event.payload.agentProfileKey }
          : {}),
        workerId: event.payload.workerId,
        sessions: [],
        errorMessage: `Failed to list sessions: ${toUserErrorMessage(err)}`,
      },
    });
  }
}
