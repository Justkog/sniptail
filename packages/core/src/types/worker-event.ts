import type { ChannelProvider } from './channel.js';
import type { JobContextFile } from './job.js';

export const WORKER_EVENT_SCHEMA_VERSION = 1 as const;

export type WorkerEventBase = {
  requestId?: string;
};

export type WorkerCodexUsagePayload = {
  provider: ChannelProvider;
  channelId: string;
  workspaceId?: string;
  userId?: string;
  threadId?: string;
  interactionToken?: string;
  interactionApplicationId?: string;
};

export type WorkerReplyTarget = {
  provider: ChannelProvider;
  channelId: string;
  userId?: string;
  threadId?: string;
  workspaceId?: string;
  guildId?: string;
};

export type WorkerRepoAddPayload = {
  response: WorkerReplyTarget;
  repoKey: string;
  repoProvider?: string;
  sshUrl?: string;
  localPath?: string;
  projectId?: number;
  baseBranch?: string;
  ifMissing?: boolean;
  upsert?: boolean;
};

export type WorkerRepoRemovePayload = {
  response: WorkerReplyTarget;
  repoKey: string;
};

export type WorkerAgentSessionStartPayload = {
  sessionId: string;
  response: WorkerReplyTarget;
  prompt: string;
  workspaceKey: string;
  agentProfileKey: string;
  cwd?: string;
  contextFiles?: JobContextFile[];
};

export type WorkerAgentSessionMessagePayload = {
  sessionId: string;
  response: WorkerReplyTarget;
  message: string;
  messageId?: string;
  mode?: 'run' | 'queue' | 'steer';
};

export type WorkerAgentPromptStopPayload = {
  sessionId: string;
  response: WorkerReplyTarget;
  reason?: string;
  messageId?: string;
};

export type WorkerAgentInteractionResolution =
  | {
      kind: 'permission';
      decision: 'once' | 'always' | 'reject';
      message?: string;
    }
  | {
      kind: 'question';
      answers?: string[][];
      reject?: boolean;
      message?: string;
    };

export type WorkerAgentInteractionResolvePayload = {
  sessionId: string;
  response: WorkerReplyTarget;
  interactionId: string;
  resolution: WorkerAgentInteractionResolution;
};

export type WorkerEventPayloadMap = {
  'jobs.clear': {
    jobId: string;
    ttlMs: number;
  };
  'jobs.clearBefore': {
    cutoffIso: string;
  };
  'repos.add': WorkerRepoAddPayload;
  'repos.remove': WorkerRepoRemovePayload;
  'status.codexUsage': WorkerCodexUsagePayload;
  'agent.metadata.request': {
    provider: ChannelProvider;
  };
  'agent.session.start': WorkerAgentSessionStartPayload;
  'agent.session.message': WorkerAgentSessionMessagePayload;
  'agent.prompt.stop': WorkerAgentPromptStopPayload;
  'agent.interaction.resolve': WorkerAgentInteractionResolvePayload;
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
