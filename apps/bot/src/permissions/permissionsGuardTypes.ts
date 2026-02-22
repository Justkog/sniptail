export type DiscordPermissionActorContext = {
  userId: string;
  channelId: string;
  threadId?: string;
  guildId?: string;
  member?: unknown;
};

export type SlackPermissionActorContext = {
  userId: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
};
