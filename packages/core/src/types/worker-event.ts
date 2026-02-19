import type { ChannelProvider } from './channel.js';

export const WORKER_EVENT_SCHEMA_VERSION = 1 as const;

export type WorkerEventBase = {
  requestId?: string;
};

export type WorkerCodexUsagePayload = {
  provider: ChannelProvider;
  channelId: string;
  userId?: string;
  threadId?: string;
  interactionToken?: string;
  interactionApplicationId?: string;
};

export type WorkerEventPayloadMap = {
  'jobs.clear': {
    jobId: string;
    ttlMs: number;
  };
  'jobs.clearBefore': {
    cutoffIso: string;
  };
  'status.codexUsage': WorkerCodexUsagePayload;
};

export type CoreWorkerEventType = keyof WorkerEventPayloadMap;

export type CoreWorkerEvent<TType extends CoreWorkerEventType = CoreWorkerEventType> =
  TType extends CoreWorkerEventType
    ? WorkerEventBase & {
        schemaVersion: typeof WORKER_EVENT_SCHEMA_VERSION;
        type: TType;
        payload: WorkerEventPayloadMap[TType];
      }
    : never;
export type WorkerEvent = CoreWorkerEvent;
