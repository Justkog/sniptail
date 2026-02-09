export type BotEventBase = {
  jobId?: string;
};

type FileUploadPayloadBase = {
  channelId: string;
  title: string;
  threadId?: string;
};

type FileUploadPayload =
  | (FileUploadPayloadBase & { filePath: string; fileContent?: never })
  | (FileUploadPayloadBase & { filePath?: never; fileContent: string });

export type BotEvent =
  | (BotEventBase & {
      provider: 'slack';
      type: 'postMessage';
      payload: {
        channelId: string;
        text: string;
        threadId?: string;
        blocks?: unknown[];
      };
    })
  | (BotEventBase & {
      provider: 'slack';
      type: 'uploadFile';
      payload: FileUploadPayload;
    })
  | (BotEventBase & {
      provider: 'slack';
      type: 'addReaction';
      payload: {
        channelId: string;
        name: string;
        timestamp: string;
      };
    })
  | (BotEventBase & {
      provider: 'slack';
      type: 'postEphemeral';
      payload: {
        channelId: string;
        userId: string;
        text: string;
        threadId?: string;
        blocks?: unknown[];
      };
    })
  | (BotEventBase & {
      provider: 'discord';
      type: 'postMessage';
      payload: {
        channelId: string;
        text: string;
        threadId?: string;
        components?: unknown[];
      };
    })
  | (BotEventBase & {
      provider: 'discord';
      type: 'uploadFile';
      payload: FileUploadPayload;
    })
  | (BotEventBase & {
      provider: 'discord';
      type: 'editInteractionReply';
      payload: {
        interactionToken: string;
        interactionApplicationId: string;
        text: string;
      };
    });
