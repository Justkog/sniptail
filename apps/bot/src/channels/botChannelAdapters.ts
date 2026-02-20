import { ChannelRegistry } from '@sniptail/core/channels/channelRegistry.js';
import type { CoreBotEvent, CoreBotEventType } from '@sniptail/core/types/bot-event.js';
import type { ChannelProvider } from '@sniptail/core/types/channel.js';
import type { RuntimeBotChannelAdapter } from './runtimeBotChannelAdapter.js';
import { DiscordBotChannelAdapter } from '../discord/discordBotChannelAdapter.js';
import { SlackBotChannelAdapter } from '../slack/slackBotChannelAdapter.js';

class GenericBotChannelAdapter implements RuntimeBotChannelAdapter {
  capabilities = {} as const;
  supportedEventTypes = [] as const satisfies readonly CoreBotEventType[];

  constructor(public readonly providerId: ChannelProvider) {}

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async handleEvent(_event: CoreBotEvent): Promise<boolean> {
    return false;
  }
}

const baseRegistry = new ChannelRegistry<RuntimeBotChannelAdapter>([
  new SlackBotChannelAdapter(),
  new DiscordBotChannelAdapter(),
]);
const genericAdapterCache = new Map<ChannelProvider, RuntimeBotChannelAdapter>();

export function resolveBotChannelAdapter(providerId: ChannelProvider): RuntimeBotChannelAdapter {
  const known = baseRegistry.resolve(providerId);
  if (known) {
    return known;
  }
  const cached = genericAdapterCache.get(providerId);
  if (cached) {
    return cached;
  }
  const adapter = new GenericBotChannelAdapter(providerId);
  genericAdapterCache.set(providerId, adapter);
  return adapter;
}
