import { ChannelRegistry } from '@sniptail/core/channels/channelRegistry.js';
import { BOT_EVENT_SCHEMA_VERSION, type CoreBotEvent } from '@sniptail/core/types/bot-event.js';
import type { ChannelProvider, ChannelRef } from '@sniptail/core/types/channel.js';
import { DiscordWorkerChannelAdapter } from '../discord/discordWorkerChannelAdapter.js';
import { SlackWorkerChannelAdapter } from '../slack/slackWorkerChannelAdapter.js';
import type { FileUpload, MessageOptions } from './notifier.js';
import {
  type BootstrapSuccessRenderInput,
  type CodexUsageRenderInput,
  type CompletionRenderInput,
  type RenderedMessage,
  type WorkerChannelAdapter,
  buildUploadPayload,
  withJobId,
} from './runtimeWorkerChannelAdapter.js';

export type {
  BootstrapSuccessRenderInput,
  CodexUsageRenderInput,
  CompletionRenderInput,
  RenderedMessage,
  WorkerChannelAdapter,
} from './runtimeWorkerChannelAdapter.js';

class GenericWorkerChannelAdapter implements WorkerChannelAdapter {
  capabilities = {
    fileUploads: true,
  } as const;

  constructor(public readonly providerId: ChannelProvider) {}

  buildPostMessageEvent(
    ref: ChannelRef,
    text: string,
    _options?: MessageOptions,
    jobId?: string,
  ): CoreBotEvent<'message.post'> {
    return withJobId(
      {
        schemaVersion: BOT_EVENT_SCHEMA_VERSION,
        provider: this.providerId,
        type: 'message.post',
        payload: {
          channelId: ref.channelId,
          text,
          ...(ref.threadId ? { threadId: ref.threadId } : {}),
        },
      },
      jobId,
    );
  }

  buildUploadFileEvent(
    ref: ChannelRef,
    file: FileUpload,
    jobId?: string,
  ): CoreBotEvent<'file.upload'> {
    return withJobId(
      {
        schemaVersion: BOT_EVENT_SCHEMA_VERSION,
        provider: this.providerId,
        type: 'file.upload',
        payload: buildUploadPayload(ref, file),
      },
      jobId,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildCodexUsageReplyEvent(_input: CodexUsageRenderInput): CoreBotEvent | undefined {
    return undefined;
  }

  renderCompletionMessage(input: CompletionRenderInput): RenderedMessage {
    return {
      text: input.text,
    };
  }

  renderBootstrapSuccessMessage(input: BootstrapSuccessRenderInput): RenderedMessage {
    return {
      text: input.text,
    };
  }
}

const baseRegistry = new ChannelRegistry<WorkerChannelAdapter>([
  new SlackWorkerChannelAdapter(),
  new DiscordWorkerChannelAdapter(),
]);

const genericAdapterCache = new Map<ChannelProvider, WorkerChannelAdapter>();

export function resolveWorkerChannelAdapter(providerId: ChannelProvider): WorkerChannelAdapter {
  const known = baseRegistry.resolve(providerId);
  if (known) {
    return known;
  }
  const cached = genericAdapterCache.get(providerId);
  if (cached) {
    return cached;
  }
  const adapter = new GenericWorkerChannelAdapter(providerId);
  genericAdapterCache.set(providerId, adapter);
  return adapter;
}

export function listWorkerChannelAdapters(): WorkerChannelAdapter[] {
  return [...baseRegistry.list(), ...genericAdapterCache.values()];
}
