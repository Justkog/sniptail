import type { ChannelAdapterBase } from '@sniptail/core/channels/adapter.js';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';
import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { WorkerCodexUsagePayload } from '@sniptail/core/types/worker-event.js';
import type { FileUpload, MessageOptions } from './notifier.js';

export type CompletionRenderInput = {
  botName: string;
  text: string;
  jobId: string;
  openQuestions?: string[];
  includeReviewFromJob?: boolean;
};

export type BootstrapSuccessRenderInput = {
  text: string;
  serviceName: string;
  repoDisplay: string;
  repoKey: string;
};

export type RenderedMessage = {
  text: string;
  options?: MessageOptions;
};

export type CodexUsageRenderInput = {
  requestId?: string;
  payload: WorkerCodexUsagePayload;
  text: string;
};

export interface WorkerChannelAdapter extends ChannelAdapterBase {
  buildPostMessageEvent(
    ref: ChannelRef,
    text: string,
    options?: MessageOptions,
    jobId?: string,
  ): CoreBotEvent<'message.post'>;
  buildUploadFileEvent(
    ref: ChannelRef,
    file: FileUpload,
    jobId?: string,
  ): CoreBotEvent<'file.upload'>;
  buildCodexUsageReplyEvent(input: CodexUsageRenderInput): CoreBotEvent | undefined;
  renderCompletionMessage(input: CompletionRenderInput): RenderedMessage;
  renderBootstrapSuccessMessage(input: BootstrapSuccessRenderInput): RenderedMessage;
}

export function withJobId<TEvent extends CoreBotEvent>(event: TEvent, jobId?: string): TEvent {
  if (!jobId) {
    return event;
  }
  return {
    ...event,
    jobId,
  };
}

export function buildUploadPayload(
  ref: ChannelRef,
  file: FileUpload,
): CoreBotEvent<'file.upload'>['payload'] {
  const basePayload = {
    channelId: ref.channelId,
    title: file.title,
    ...(ref.threadId ? { threadId: ref.threadId } : {}),
  };
  if ('filePath' in file) {
    return {
      ...basePayload,
      filePath: file.filePath,
    };
  }
  return {
    ...basePayload,
    fileContent: file.fileContent,
  };
}
