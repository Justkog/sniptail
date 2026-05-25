import {
  BOT_EVENT_SCHEMA_VERSION,
  type BotAgentSessionPreviewMessage,
} from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import { logger } from '@sniptail/core/logger.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import {
  getAgentSessionPreviewAdapter,
  type AgentSessionPreviewAdapterRegistry,
} from './agentSessionPreviewAdapters.js';
import type { InteractiveAgentProfile } from './interactiveAgentTypes.js';
import { resolveAgentWorkspace, type ResolvedAgentWorkspace } from './workspaceResolver.js';

type AgentSessionPreviewEvent = CoreWorkerEvent<'agent.session.preview'>;

const UNSUPPORTED_PREVIEW_MESSAGE =
  'Sniptail attached the session, but this provider does not expose previous-session message history for preview yet.';

function resolveAgentProfile(
  config: WorkerConfig,
  agentProfileKey: string,
): InteractiveAgentProfile | undefined {
  const profile = config.agent.profiles[agentProfileKey];
  return profile ? { key: agentProfileKey, ...profile } : undefined;
}

function toUserErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.';
}

async function resolvePreviewWorkspace(
  config: WorkerConfig,
  event: AgentSessionPreviewEvent,
): Promise<ResolvedAgentWorkspace | undefined> {
  if (!event.payload.workspaceKey) {
    if (event.payload.cwd) {
      throw new Error('Cannot preview an attached session cwd without a workspace key.');
    }
    return undefined;
  }

  return resolveAgentWorkspace(config.agent.workspaces, {
    workspaceKey: event.payload.workspaceKey,
    ...(event.payload.cwd ? { cwd: event.payload.cwd } : {}),
  });
}

async function publishPreviewResult(input: {
  event: AgentSessionPreviewEvent;
  botEvents: BotEventSink;
  message?: BotAgentSessionPreviewMessage;
  errorMessage?: string;
}): Promise<void> {
  const { event, botEvents } = input;
  const { response } = event.payload;
  if (!response.threadId) {
    logger.warn({ event }, 'Cannot publish agent session preview without a reply thread id');
    return;
  }

  await botEvents.publish({
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: response.provider,
    ...(event.requestId ? { requestId: event.requestId } : {}),
    type: 'agent.session.previewed',
    payload: {
      channelId: response.channelId,
      threadId: response.threadId,
      ...(response.userId ? { userId: response.userId } : {}),
      ...(response.guildId ? { guildId: response.guildId } : {}),
      sessionId: event.payload.sessionId,
      workerId: event.payload.workerId,
      agentProfileKey: event.payload.agentProfileKey,
      provider: event.payload.provider,
      providerSessionId: event.payload.providerSessionId,
      ...(event.payload.workspaceKey ? { workspaceKey: event.payload.workspaceKey } : {}),
      ...(event.payload.cwd ? { cwd: event.payload.cwd } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    },
  });
}

export async function handleAgentSessionPreview(input: {
  event: AgentSessionPreviewEvent;
  config: WorkerConfig;
  botEvents: BotEventSink;
  adapters?: AgentSessionPreviewAdapterRegistry;
}): Promise<void> {
  const { event, config, botEvents, adapters } = input;

  try {
    if (!config.agent.enabled) {
      await publishPreviewResult({
        event,
        botEvents,
        errorMessage: 'Agent sessions are not enabled on this worker.',
      });
      return;
    }
    if (event.payload.workerId !== config.workerId) {
      await publishPreviewResult({
        event,
        botEvents,
        errorMessage: `Worker "${event.payload.workerId}" does not match this worker.`,
      });
      return;
    }

    const profile = resolveAgentProfile(config, event.payload.agentProfileKey);
    if (!profile) {
      await publishPreviewResult({
        event,
        botEvents,
        errorMessage: `Unknown agent profile: ${event.payload.agentProfileKey}`,
      });
      return;
    }
    if (profile.provider !== event.payload.provider) {
      await publishPreviewResult({
        event,
        botEvents,
        errorMessage: 'The selected session profile provider no longer matches the session.',
      });
      return;
    }

    const adapter = getAgentSessionPreviewAdapter(event.payload.provider, adapters);
    if (!adapter) {
      await publishPreviewResult({ event, botEvents, errorMessage: UNSUPPORTED_PREVIEW_MESSAGE });
      return;
    }

    const resolvedWorkspace = await resolvePreviewWorkspace(config, event);
    const result = await adapter.previewSession({
      config,
      profile,
      providerSessionId: event.payload.providerSessionId,
      ...(event.payload.workspaceKey ? { workspaceKey: event.payload.workspaceKey } : {}),
      ...(event.payload.cwd ? { cwd: event.payload.cwd } : {}),
      ...(resolvedWorkspace ? { resolvedWorkspace } : {}),
    });
    await publishPreviewResult({
      event,
      botEvents,
      ...(result.message ? { message: result.message } : {}),
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    });
  } catch (err) {
    logger.error({ err, event }, 'Failed to preview attached agent session');
    await publishPreviewResult({
      event,
      botEvents,
      errorMessage: `Failed to read the attached session preview: ${toUserErrorMessage(err)}`,
    });
  }
}
