import type { ChannelProvider } from './channel.js';

export const BOT_EVENT_SCHEMA_VERSION = 1 as const;

export type BotEventBase = {
  jobId?: string;
};

type FileUploadPayloadBase = {
  channelId: string;
  title: string;
  threadId?: string;
};

export type FileUploadPayload =
  | (FileUploadPayloadBase & { filePath: string; fileContent?: never })
  | (FileUploadPayloadBase & { filePath?: never; fileContent: string });

export type BotEventPayloadMap = {
  'message.post': {
    channelId: string;
    text: string;
    threadId?: string;
    blocks?: unknown[];
    components?: unknown[];
  };
  'message.ephemeral': {
    channelId: string;
    userId: string;
    text: string;
    threadId?: string;
    blocks?: unknown[];
  };
  'file.upload': FileUploadPayload;
  'reaction.add': {
    channelId: string;
    name: string;
    timestamp: string;
  };
  'interaction.reply.edit': {
    interactionToken: string;
    interactionApplicationId: string;
    text: string;
  };
};

export type CoreBotEventType = keyof BotEventPayloadMap;

export type CoreBotEvent<TType extends CoreBotEventType = CoreBotEventType> =
  TType extends CoreBotEventType
    ? BotEventBase & {
        schemaVersion: typeof BOT_EVENT_SCHEMA_VERSION;
        provider: ChannelProvider;
        type: TType;
        payload: BotEventPayloadMap[TType];
      }
    : never;
export type BotEvent = CoreBotEvent;
