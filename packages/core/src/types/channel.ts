export type KnownChannelProvider = 'slack' | 'discord';
export const KNOWN_CHANNEL_PROVIDERS: KnownChannelProvider[] = ['slack', 'discord'];
export type ChannelProvider = KnownChannelProvider | (string & {});

export function isKnownChannelProvider(
  provider: ChannelProvider,
): provider is KnownChannelProvider {
  return (KNOWN_CHANNEL_PROVIDERS as string[]).includes(provider);
}

export type ChannelContextBase = {
  provider: ChannelProvider;
  channelId: string;
  threadId?: string;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export type SlackChannelContext = ChannelContextBase & {
  provider: 'slack';
  userId: string;
};

export type DiscordChannelContext = ChannelContextBase & {
  provider: 'discord';
  guildId?: string;
  interactionToken?: string;
  interactionApplicationId?: string;
};

export type GenericChannelContext = ChannelContextBase;

export type ChannelContext = SlackChannelContext | DiscordChannelContext | GenericChannelContext;

export type ChannelRef = Pick<ChannelContextBase, 'provider' | 'channelId' | 'threadId'>;
