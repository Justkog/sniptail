import { buildCompletionBlocks } from '@sniptail/core/slack/blocks.js';
import { buildSlackIds } from '@sniptail/core/slack/ids.js';
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

export class SlackWorkerChannelAdapter implements WorkerChannelAdapter {
  providerId = 'slack' as const;
  capabilities = {
    threads: true,
    richTextBlocks: true,
    ephemeralMessages: true,
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
          ...(options?.blocks ? { blocks: options.blocks } : {}),
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
    if (!payload.userId) {
      return undefined;
    }
    return {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: this.providerId,
      type: 'message.ephemeral',
      payload: {
        channelId: payload.channelId,
        userId: payload.userId,
        text,
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
      },
      ...(requestId ? { jobId: requestId } : {}),
    };
  }

  renderCompletionMessage(input: CompletionRenderInput): RenderedMessage {
    const slackIds = buildSlackIds(input.botName);
    const openQuestions = input.openQuestions ?? [];
    const hasOpenQuestions = openQuestions.length > 0;
    const blocks = buildCompletionBlocks(
      input.text,
      input.jobId,
      {
        askFromJob: slackIds.actions.askFromJob,
        exploreFromJob: slackIds.actions.exploreFromJob,
        planFromJob: slackIds.actions.planFromJob,
        implementFromJob: slackIds.actions.implementFromJob,
        runFromJob: slackIds.actions.runFromJob,
        reviewFromJob: slackIds.actions.reviewFromJob,
        worktreeCommands: slackIds.actions.worktreeCommands,
        clearJob: slackIds.actions.clearJob,
        ...(hasOpenQuestions ? { answerQuestions: slackIds.actions.answerQuestions } : {}),
      },
      hasOpenQuestions
        ? {
            includeAskFromJob: false,
            includeExploreFromJob: false,
            includePlanFromJob: false,
            includeImplementFromJob: false,
            includeRunFromJob: false,
            includeReviewFromJob: false,
            answerQuestionsFirst: true,
          }
        : {
            ...(input.includeReviewFromJob !== undefined
              ? { includeReviewFromJob: input.includeReviewFromJob }
              : {}),
          },
    );
    return {
      text: input.text,
      options: {
        blocks,
      },
    };
  }

  renderBootstrapSuccessMessage(input: BootstrapSuccessRenderInput): RenderedMessage {
    return {
      text: input.text,
      options: {
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${input.serviceName} repo created*\\n• Repo: ${input.repoDisplay}\\n• Allowlist key: \`${input.repoKey}\``,
            },
          },
        ],
      },
    };
  }
}
