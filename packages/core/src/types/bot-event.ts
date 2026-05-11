import type { ChannelProvider } from './channel.js';
import type { ModelReasoningEffort } from '@openai/codex-sdk';

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

export type BotAgentWorkspaceMetadata = {
  key: string;
  label?: string;
  description?: string;
};

export type BotAgentProfileMetadata = {
  key: string;
  provider: 'codex' | 'opencode' | 'copilot' | 'acp';
  agent?: string;
  profile?: string;
  model?: string;
  modelProvider?: string;
  reasoningEffort?: ModelReasoningEffort;
  label?: string;
  description?: string;
};

export type BotAgentPermissionRequestPayload = {
  channelId: string;
  threadId: string;
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  toolName?: string;
  action?: string;
  details?: string[];
  expiresAt: string;
  allowAlways: boolean;
};

export type BotAgentPermissionUpdatePayload = {
  channelId: string;
  threadId: string;
  sessionId: string;
  interactionId: string;
  status: 'approved_once' | 'approved_always' | 'rejected' | 'expired' | 'failed';
  actorUserId?: string;
  message?: string;
};

export type BotAgentQuestionOption = {
  label: string;
  description?: string;
};

export type BotAgentQuestion = {
  header?: string;
  question: string;
  options: BotAgentQuestionOption[];
  multiple: boolean;
  custom: boolean;
};

export type BotAgentQuestionRequestPayload = {
  channelId: string;
  threadId: string;
  sessionId: string;
  interactionId: string;
  workspaceKey: string;
  cwd?: string;
  questions: BotAgentQuestion[];
  expiresAt: string;
};

export type BotAgentQuestionUpdatePayload = {
  channelId: string;
  threadId: string;
  sessionId: string;
  interactionId: string;
  status: 'answered' | 'rejected' | 'expired' | 'failed';
  actorUserId?: string;
  message?: string;
};

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
    workspaceId?: string;
    userId: string;
    text: string;
    threadId?: string;
    blocks?: unknown[];
  };
  'file.upload': FileUploadPayload;
  'reaction.add': {
    channelId: string;
    messageId: string;
    threadId?: string;
    name: string;
  };
  'interaction.reply.edit': {
    interactionToken: string;
    interactionApplicationId: string;
    text: string;
  };
  'agent.metadata.update': {
    enabled: boolean;
    defaultWorkspace?: string;
    defaultAgentProfile?: string;
    workspaces: BotAgentWorkspaceMetadata[];
    profiles: BotAgentProfileMetadata[];
    receivedAt: string;
  };
  'agent.permission.requested': BotAgentPermissionRequestPayload;
  'agent.permission.updated': BotAgentPermissionUpdatePayload;
  'agent.question.requested': BotAgentQuestionRequestPayload;
  'agent.question.updated': BotAgentQuestionUpdatePayload;
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
