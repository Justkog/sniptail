export type WorkerEventBase = {
  requestId?: string;
};

export type WorkerEvent =
  | (WorkerEventBase & {
      type: 'clearJob';
      payload: {
        jobId: string;
        ttlMs: number;
      };
    })
  | (WorkerEventBase & {
      type: 'clearJobsBefore';
      payload: {
        cutoffIso: string;
      };
    })
  | (WorkerEventBase & {
      type: 'codexUsage';
      payload:
        | {
            provider: 'slack';
            channelId: string;
            userId: string;
            threadId?: string;
          }
        | {
            provider: 'discord';
            channelId: string;
            threadId?: string;
          };
    });
