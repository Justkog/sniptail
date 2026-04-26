import { BOT_EVENT_SCHEMA_VERSION, type CoreBotEvent } from '@sniptail/core/types/bot-event.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { FileUpload, MessageOptions } from '../channels/notifier.js';
import {
  type BootstrapSuccessRenderInput,
  type CodexUsageRenderInput,
  type CompletionRenderInput,
  type RenderedMessage,
  type WorkerChannelAdapter,
  buildUploadPayload,
  withJobId,
} from '../channels/runtimeWorkerChannelAdapter.js';

export class TelegramWorkerChannelAdapter implements WorkerChannelAdapter {
  providerId = 'telegram' as const;
  capabilities = {
    fileUploads: true,
  } as const;

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

  buildAddReactionEvent(
    _ref: ChannelRef,
    _name: string,
    _timestamp: string,
    _jobId?: string,
  ): CoreBotEvent<'reaction.add'> | undefined {
    return undefined;
  }

  buildCodexUsageReplyEvent({
    requestId,
    payload,
    text,
  }: CodexUsageRenderInput): CoreBotEvent | undefined {
    return {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: this.providerId,
      type: 'message.post',
      payload: {
        channelId: payload.channelId,
        text,
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
      },
      ...(requestId ? { jobId: requestId } : {}),
    };
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
