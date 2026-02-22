import { buildDiscordCompletionComponents } from '@sniptail/core/discord/components.js';
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

export class DiscordWorkerChannelAdapter implements WorkerChannelAdapter {
  providerId = 'discord' as const;
  capabilities = {
    threads: true,
    richComponents: true,
    interactionReplies: true,
    fileUploads: true,
  } as const;

  buildPostMessageEvent(
    ref: ChannelRef,
    text: string,
    options?: MessageOptions,
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
          ...(options?.components ? { components: options.components } : {}),
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

  buildCodexUsageReplyEvent({
    requestId,
    payload,
    text,
  }: CodexUsageRenderInput): CoreBotEvent | undefined {
    if (!payload.interactionToken || !payload.interactionApplicationId) {
      return undefined;
    }
    return {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: this.providerId,
      type: 'interaction.reply.edit',
      payload: {
        interactionApplicationId: payload.interactionApplicationId,
        interactionToken: payload.interactionToken,
        text,
      },
      ...(requestId ? { jobId: requestId } : {}),
    };
  }

  renderCompletionMessage(input: CompletionRenderInput): RenderedMessage {
    const openQuestions = input.openQuestions ?? [];
    const hasOpenQuestions = openQuestions.length > 0;
    const components = buildDiscordCompletionComponents(input.jobId, {
      includeAnswerQuestions: hasOpenQuestions,
      includeAskFromJob: !hasOpenQuestions,
      includeExploreFromJob: !hasOpenQuestions,
      includePlanFromJob: !hasOpenQuestions,
      includeImplementFromJob: !hasOpenQuestions,
      includeReviewFromJob: hasOpenQuestions ? false : (input.includeReviewFromJob ?? false),
      answerQuestionsFirst: hasOpenQuestions,
    });
    return {
      text: input.text,
      options: {
        components,
      },
    };
  }

  renderBootstrapSuccessMessage(input: BootstrapSuccessRenderInput): RenderedMessage {
    return {
      text: input.text,
    };
  }
}
