import { logger } from '@sniptail/core/logger.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { submitNormalizedJobRequest } from '../job-requests/engine.js';
import { refreshRepoAllowlist } from '../lib/repoAllowlist.js';
import { parseCutoffDateInput } from '../slack/lib/parsing.js';
import { buildTelegramChannelContext } from './lib/channel.js';
import { clearTelegramWizardState, loadTelegramWizardState, saveTelegramWizardState } from './state.js';
import {
  buildTelegramAcceptedText,
  buildTelegramCancelKeyboard,
  buildTelegramHelpText,
  buildTelegramRepoSelectionKeyboard,
  buildTelegramWizardExpiredText,
  buildTelegramWizardPrompt,
  parseRepoAndRequestInput,
  parseRunInput,
} from './helpers.js';
import { editTelegramMessage, sendTelegramMessage } from './lib/messageEditing.js';
import type { TelegramHandlerContext } from './context.js';
import { authorizeTelegramOperationAndRespond, enqueueTelegramUsageRequest, resolveTelegramApprovalCallback } from './permissions/telegramPermissionGuards.js';

type TelegramJobType = 'ASK' | 'EXPLORE' | 'PLAN' | 'IMPLEMENT' | 'REVIEW';

function toChatId(chatId: number | string | null | undefined): string | undefined {
  if (chatId == null) {
    return undefined;
  }
  return String(chatId);
}

function isAllowedChat(context: TelegramHandlerContext, chatId: string): boolean {
  const allowed = context.config.telegram?.chatIds;
  return !allowed || allowed.length === 0 || allowed.includes(chatId);
}

function commandArgs(messageText: string): string {
  return messageText.replace(/^\/\S+/, '').trim();
}

function parseJobType(command: string): TelegramJobType | undefined {
  switch (command) {
    case 'ask':
      return 'ASK';
    case 'explore':
      return 'EXPLORE';
    case 'plan':
      return 'PLAN';
    case 'implement':
      return 'IMPLEMENT';
    case 'review':
      return 'REVIEW';
    default:
      return undefined;
  }
}

async function submitTelegramJob(input: {
  context: TelegramHandlerContext;
  type: TelegramJobType;
  userId: string;
  chatId: string;
  replyToMessageId: string;
  requestText: string;
  repoKeys: string[];
  promptMessageId?: number;
}) {
  const action = (() => {
    switch (input.type) {
      case 'ASK':
        return 'jobs.ask';
      case 'EXPLORE':
        return 'jobs.explore';
      case 'PLAN':
        return 'jobs.plan';
      case 'IMPLEMENT':
        return 'jobs.implement';
      case 'REVIEW':
        return 'jobs.review';
      default:
        throw new Error(`Unsupported Telegram job type: ${String(input.type)}`);
    }
  })();

  const { context } = input;
  await refreshRepoAllowlist(context.config);
  const result = await submitNormalizedJobRequest({
    config: context.config,
    queue: context.queue,
    input: {
      type: input.type,
      repoKeys: input.repoKeys,
      requestText: input.requestText,
      channel: buildTelegramChannelContext({
        chatId: input.chatId,
        userId: input.userId,
        replyToMessageId: input.replyToMessageId,
      }),
    },
    authorize: async (job) =>
      authorizeTelegramOperationAndRespond({
        bot: context.bot,
        permissions: context.permissions,
        action,
        summary: `Queue ${input.type.toLowerCase()} job ${job.jobId}`,
        operation: {
          kind: 'enqueueJob',
          job,
        },
        userId: input.userId,
        channelId: input.chatId,
        threadId: input.promptMessageId ? String(input.promptMessageId) : input.replyToMessageId,
        ...(input.promptMessageId ? { approvalMessageId: input.promptMessageId } : {}),
        onDeny: async (message) => {
          if (input.promptMessageId) {
            await editTelegramMessage(context.bot, input.chatId, input.promptMessageId, message);
            return;
          }
          await sendTelegramMessage(context.bot, input.chatId, message);
        },
      }),
  });

  if (result.status === 'invalid') {
    if (input.promptMessageId) {
      await editTelegramMessage(context.bot, input.chatId, input.promptMessageId, result.message);
    } else {
      await sendTelegramMessage(context.bot, input.chatId, result.message);
    }
    return;
  }
  if (result.status === 'stopped') {
    return;
  }
  if (result.status === 'persist_failed') {
    const message = `I couldn't persist job ${result.job.jobId}. Please try again.`;
    if (input.promptMessageId) {
      await editTelegramMessage(context.bot, input.chatId, input.promptMessageId, message);
    } else {
      await sendTelegramMessage(context.bot, input.chatId, message);
    }
    return;
  }

  const message = buildTelegramAcceptedText(result.job.jobId, input.type);
  if (input.promptMessageId) {
    await editTelegramMessage(context.bot, input.chatId, input.promptMessageId, message);
  } else {
    await sendTelegramMessage(context.bot, input.chatId, message, undefined, Number.parseInt(input.replyToMessageId, 10));
  }
}

async function submitTelegramRun(input: {
  context: TelegramHandlerContext;
  userId: string;
  chatId: string;
  replyToMessageId: string;
  raw: string;
}) {
  const parsed = parseRunInput(input.raw);
  if (!parsed) {
    await sendTelegramMessage(
      input.context.bot,
      input.chatId,
      'Usage: /run repo-a,repo-b | action-id | key=value,key2=value2',
      undefined,
      Number.parseInt(input.replyToMessageId, 10),
    );
    return;
  }

  await refreshRepoAllowlist(input.context.config);
  const result = await submitNormalizedJobRequest({
    config: input.context.config,
    queue: input.context.queue,
    input: {
      type: 'RUN',
      repoKeys: parsed.repoKeys,
      requestText: `Run action ${parsed.actionId}`,
      channel: buildTelegramChannelContext({
        chatId: input.chatId,
        userId: input.userId,
        replyToMessageId: input.replyToMessageId,
      }),
      run: {
        actionId: parsed.actionId,
        ...(parsed.params ? { params: parsed.params } : {}),
      },
    },
    authorize: async (job) =>
      authorizeTelegramOperationAndRespond({
        bot: input.context.bot,
        permissions: input.context.permissions,
        action: 'jobs.run',
        summary: `Queue run job ${job.jobId}`,
        operation: {
          kind: 'enqueueJob',
          job,
        },
        userId: input.userId,
        channelId: input.chatId,
        threadId: input.replyToMessageId,
        onDeny: async (message) => {
          await sendTelegramMessage(input.context.bot, input.chatId, message);
        },
      }),
  });

  if (result.status === 'accepted') {
    await sendTelegramMessage(
      input.context.bot,
      input.chatId,
      buildTelegramAcceptedText(result.job.jobId, 'RUN'),
      undefined,
      Number.parseInt(input.replyToMessageId, 10),
    );
    return;
  }
  if (result.status === 'invalid') {
    await sendTelegramMessage(input.context.bot, input.chatId, result.message);
    return;
  }
  if (result.status === 'persist_failed') {
    await sendTelegramMessage(
      input.context.bot,
      input.chatId,
      `I couldn't persist job ${result.job.jobId}. Please try again.`,
    );
  }
}

async function submitTelegramMention(input: {
  context: TelegramHandlerContext;
  userId: string;
  chatId: string;
  messageId: string;
  text: string;
}) {
  const result = await submitNormalizedJobRequest({
    config: input.context.config,
    queue: input.context.queue,
    input: {
      type: 'MENTION',
      repoKeys: [],
      requestText: input.text,
      channel: buildTelegramChannelContext({
        chatId: input.chatId,
        userId: input.userId,
        replyToMessageId: input.messageId,
      }),
    },
    authorize: async (job) =>
      authorizeTelegramOperationAndRespond({
        bot: input.context.bot,
        permissions: input.context.permissions,
        action: 'jobs.mention',
        summary: `Queue mention job ${job.jobId}`,
        operation: {
          kind: 'enqueueJob',
          job,
        },
        userId: input.userId,
        channelId: input.chatId,
        threadId: input.messageId,
        onDeny: async (message) => {
          await sendTelegramMessage(input.context.bot, input.chatId, message);
        },
      }),
  });

  if (result.status === 'accepted') {
    await sendTelegramMessage(
      input.context.bot,
      input.chatId,
      buildTelegramAcceptedText(result.job.jobId, 'MENTION'),
      undefined,
      Number.parseInt(input.messageId, 10),
    );
  }
}

export function registerTelegramHandlers(context: TelegramHandlerContext): void {
  const { bot, config } = context;

  bot.command('start', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    if (!chatId || !isAllowedChat(context, chatId)) {
      return;
    }
    await ctx.reply(buildTelegramHelpText(config.botName));
  });

  bot.command('usage', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    const userId = String(ctx.from?.id ?? '');
    const messageId = ctx.msg?.message_id;
    if (!chatId || !userId || !messageId || !isAllowedChat(context, chatId)) {
      return;
    }
    const promptMessageId = await sendTelegramMessage(
      bot,
      chatId,
      'Preparing Codex usage request...',
      undefined,
      messageId,
    );
    if (!promptMessageId) {
      return;
    }
    await enqueueTelegramUsageRequest({
      bot,
      workerEventQueue: context.workerEventQueue,
      permissions: context.permissions,
      userId,
      channelId: chatId,
      threadId: String(messageId),
      replyMessageId: promptMessageId,
    });
  });

  for (const command of ['ask', 'explore', 'plan', 'implement', 'review'] as const) {
    bot.command(command, async (ctx: any) => {
      const chatId = toChatId(ctx.chat?.id);
      const userId = String(ctx.from?.id ?? '');
      const messageId = ctx.msg?.message_id;
      if (!chatId || !userId || !messageId || !isAllowedChat(context, chatId)) {
        return;
      }
      const type = parseJobType(command);
      if (!type) {
        return;
      }
      const args = commandArgs(ctx.msg?.text ?? '');
      if (args) {
        const parsed = parseRepoAndRequestInput(args);
        if (!parsed) {
          await ctx.reply(`Usage: /${command} repo-a,repo-b | your request`);
          return;
        }
        await submitTelegramJob({
          context,
          type,
          userId,
          chatId,
          replyToMessageId: String(messageId),
          requestText: parsed.requestText,
          repoKeys: parsed.repoKeys,
        });
        return;
      }

      const promptMessageId = await sendTelegramMessage(
        bot,
        chatId,
        buildTelegramWizardPrompt(type, 'request'),
        buildTelegramCancelKeyboard(),
        messageId,
      );
      if (!promptMessageId) {
        return;
      }
      saveTelegramWizardState(chatId, userId, {
        type,
        step: 'request',
        promptMessageId,
        startedAt: Date.now(),
      });
    });
  }

  bot.command('run', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    const userId = String(ctx.from?.id ?? '');
    const messageId = ctx.msg?.message_id;
    if (!chatId || !userId || !messageId || !isAllowedChat(context, chatId)) {
      return;
    }
    await submitTelegramRun({
      context,
      userId,
      chatId,
      replyToMessageId: String(messageId),
      raw: commandArgs(ctx.msg?.text ?? ''),
    });
  });

  bot.command('clearbefore', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    const userId = String(ctx.from?.id ?? '');
    const messageId = ctx.msg?.message_id;
    if (!chatId || !userId || !messageId || !isAllowedChat(context, chatId)) {
      return;
    }
    const cutoffInput = commandArgs(ctx.msg?.text ?? '');
    const cutoff = parseCutoffDateInput(cutoffInput);
    if (!cutoff) {
      await ctx.reply('Usage: /clearbefore YYYY-MM-DD (or ISO timestamp).');
      return;
    }
    const cutoffIso = cutoff.toISOString();
    const event = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      type: 'jobs.clearBefore' as const,
      payload: {
        cutoffIso,
      },
    };
    const promptMessageId = await sendTelegramMessage(
      bot,
      chatId,
      'Preparing clear-before request...',
      undefined,
      messageId,
    );
    if (!promptMessageId) {
      return;
    }
    const authorized = await authorizeTelegramOperationAndRespond({
      bot,
      permissions: context.permissions,
      action: 'jobs.clearBefore',
      summary: `Clear jobs before ${cutoffIso}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
      },
      userId,
      channelId: chatId,
      threadId: String(promptMessageId),
      approvalMessageId: promptMessageId,
      onDeny: async (message) => {
        await editTelegramMessage(bot, chatId, promptMessageId, message);
      },
    });
    if (!authorized) {
      return;
    }
    await enqueueWorkerEvent(context.workerEventQueue, event);
    await editTelegramMessage(bot, chatId, promptMessageId, `Queued clear-before request for ${cutoffIso}.`);
  });

  bot.on('callback_query:data', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    const userId = String(ctx.from?.id ?? '');
    const data = ctx.callbackQuery?.data ?? '';
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!chatId || !userId || !data || !messageId || !isAllowedChat(context, chatId)) {
      return;
    }
    await ctx.answerCallbackQuery?.();

    if (data === 'cancel') {
      clearTelegramWizardState(chatId, userId);
      await editTelegramMessage(bot, chatId, messageId, 'Cancelled.');
      return;
    }
    if (data.startsWith('repo:')) {
      const state = loadTelegramWizardState(chatId, userId);
      if (!state || state.step !== 'repos' || !state.requestText) {
        await editTelegramMessage(bot, chatId, messageId, buildTelegramWizardExpiredText());
        return;
      }
      clearTelegramWizardState(chatId, userId);
      await submitTelegramJob({
        context,
        type: state.type,
        userId,
        chatId,
        replyToMessageId: String(state.promptMessageId),
        requestText: state.requestText,
        repoKeys: [data.slice('repo:'.length)],
        promptMessageId: state.promptMessageId,
      });
      return;
    }
    if (data.startsWith('approval:')) {
      const [, action, approvalId] = data.split(':');
      if (!approvalId) {
        return;
      }
      const resolutionAction =
        action === 'grant'
          ? 'approval.grant'
          : action === 'deny'
            ? 'approval.deny'
            : 'approval.cancel';
      await resolveTelegramApprovalCallback({
        bot,
        permissions: context.permissions,
        approvalId,
        resolutionAction,
        userId,
        channelId: chatId,
        messageId,
        threadId: String(messageId),
      });
    }
  });

  bot.on('message:text', async (ctx: any) => {
    const chatId = toChatId(ctx.chat?.id);
    const userId = String(ctx.from?.id ?? '');
    const messageId = ctx.msg?.message_id;
    const text = (ctx.msg?.text ?? '').trim();
    if (!chatId || !userId || !messageId || !text || !isAllowedChat(context, chatId)) {
      return;
    }
    if (text.startsWith('/')) {
      return;
    }

    const state = loadTelegramWizardState(chatId, userId);
    if (state) {
      if (state.step === 'request') {
        await refreshRepoAllowlist(context.config);
        saveTelegramWizardState(chatId, userId, {
          ...state,
          step: 'repos',
          requestText: text,
        });
        const repoKeys = Object.keys(context.config.repoAllowlist).sort();
        await editTelegramMessage(
          bot,
          chatId,
          state.promptMessageId,
          buildTelegramWizardPrompt(state.type, 'repos', text),
          buildTelegramRepoSelectionKeyboard(repoKeys) ?? buildTelegramCancelKeyboard(),
        );
        return;
      }

      if (state.step === 'repos') {
        const repoKeys = text
          .split(',')
          .map((value: string) => value.trim())
          .filter(Boolean);
        if (!repoKeys.length || !state.requestText) {
          await sendTelegramMessage(bot, chatId, 'Please send one or more repo keys separated by commas.', undefined, messageId);
          return;
        }
        clearTelegramWizardState(chatId, userId);
        await submitTelegramJob({
          context,
          type: state.type,
          userId,
          chatId,
          replyToMessageId: String(state.promptMessageId),
          requestText: state.requestText,
          repoKeys,
          promptMessageId: state.promptMessageId,
        });
        return;
      }
    }

    const chatType = ctx.chat?.type;
    const isPrivateChat = chatType === 'private';
    const username = bot.botInfo?.username;
    const mentioned = Boolean(username && text.includes(`@${username}`));
    if (!isPrivateChat && !mentioned) {
      return;
    }
    await submitTelegramMention({
      context,
      userId,
      chatId,
      messageId: String(messageId),
      text,
    });
  });

  logger.info('Registered Telegram handlers');
}
