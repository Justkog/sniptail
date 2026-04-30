import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import {
  BOT_EVENT_SCHEMA_VERSION,
  type BotEvent,
  type BotEventPayloadMap,
} from '@sniptail/core/types/bot-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';

function buildAgentMetadataPayload(): BotEventPayloadMap['agent.metadata.update'] {
  const config = loadWorkerConfig();
  const agentConfig = config.agent ?? {
    enabled: false,
    workspaces: {},
    profiles: {},
  };
  const workspaces = Object.entries(agentConfig.workspaces)
    .map(([key, workspace]) => ({
      key,
      ...(workspace.label ? { label: workspace.label } : {}),
      ...(workspace.description ? { description: workspace.description } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const profiles = Object.entries(agentConfig.profiles)
    .map(([key, profile]) => ({
      key,
      provider: profile.provider,
      name: profile.name,
      ...(profile.label ? { label: profile.label } : {}),
      ...(profile.description ? { description: profile.description } : {}),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    enabled: agentConfig.enabled,
    ...(agentConfig.defaultWorkspace ? { defaultWorkspace: agentConfig.defaultWorkspace } : {}),
    ...(agentConfig.defaultAgentProfile
      ? { defaultAgentProfile: agentConfig.defaultAgentProfile }
      : {}),
    workspaces,
    profiles,
    receivedAt: new Date().toISOString(),
  };
}

export async function publishAgentMetadataUpdate(botEvents: BotEventSink): Promise<void> {
  const event: BotEvent = {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider: 'discord',
    type: 'agent.metadata.update',
    payload: buildAgentMetadataPayload(),
  };
  await botEvents.publish(event);
}
