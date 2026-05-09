import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import {
  BOT_EVENT_SCHEMA_VERSION,
  type BotEvent,
  type BotEventPayloadMap,
} from '@sniptail/core/types/bot-event.js';
import { KNOWN_CHANNEL_PROVIDERS, type ChannelProvider } from '@sniptail/core/types/channel.js';
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
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.agent ? { agent: profile.agent } : {}),
      ...(profile.profile ? { profile: profile.profile } : {}),
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.modelProvider ? { modelProvider: profile.modelProvider } : {}),
      ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
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

function metadataProviders(): ChannelProvider[] {
  return KNOWN_CHANNEL_PROVIDERS.filter(
    (provider) => provider === 'discord' || provider === 'slack',
  );
}

export async function publishAgentMetadataUpdateForProvider(
  botEvents: BotEventSink,
  provider: ChannelProvider,
): Promise<void> {
  const payload = buildAgentMetadataPayload();
  const event: BotEvent = {
    schemaVersion: BOT_EVENT_SCHEMA_VERSION,
    provider,
    type: 'agent.metadata.update',
    payload,
  };
  await botEvents.publish(event);
}

export async function publishAgentMetadataUpdate(botEvents: BotEventSink): Promise<void> {
  for (const provider of metadataProviders()) {
    await publishAgentMetadataUpdateForProvider(botEvents, provider);
  }
}
