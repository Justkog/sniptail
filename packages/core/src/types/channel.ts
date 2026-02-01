export type ChannelProvider = 'slack' | 'discord';

export type SlackChannelContext = {
  provider: 'slack';
  channelId: string;
  threadId?: string;
  userId: string;
};

export type DiscordChannelContext = {
  provider: 'discord';
  channelId: string;
  threadId?: string;
  userId: string;
  guildId?: string;
};

export type ChannelContext = SlackChannelContext | DiscordChannelContext;

export type ChannelRef = {
  provider: ChannelProvider;
  channelId: string;
  threadId?: string;
};
