export type BotEventBase = {
  jobId?: string;
};

export type BotEvent =
  | (BotEventBase & {
      type: 'postMessage';
      payload: {
        channel: string;
        text: string;
        threadTs?: string;
        blocks?: unknown[];
      };
    })
  | (BotEventBase & {
      type: 'uploadFile';
      payload: {
        channel: string;
        filePath: string;
        title: string;
        threadTs?: string;
      };
    })
  | (BotEventBase & {
      type: 'addReaction';
      payload: {
        channel: string;
        name: string;
        timestamp: string;
      };
    });
