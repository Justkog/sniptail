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
    });
