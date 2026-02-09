export type BotEventBase = {
  jobId?: string;
};

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
      payload: {
        channelId: string;
        filePath?: string;
        fileContent?: string;
        title: string;
        threadId?: string;
      };
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
      payload: {
        channelId: string;
        filePath?: string;
        fileContent?: string;
        title: string;
        threadId?: string;
      };
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
