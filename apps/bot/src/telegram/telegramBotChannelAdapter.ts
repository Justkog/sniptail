import { logger } from '@sniptail/core/logger.js';
import type { CoreBotEvent, CoreBotEventType } from '@sniptail/core/types/bot-event.js';
import type {
  RuntimeBotChannelAdapter,
  BotEventRuntime,
} from '../channels/runtimeBotChannelAdapter.js';

function parseChatId(channelId: string): number | string {
  const parsed = Number(channelId);
  return Number.isNaN(parsed) ? channelId : parsed;
}

export class TelegramBotChannelAdapter implements RuntimeBotChannelAdapter {
  providerId = 'telegram' as const;
  capabilities = {
    fileUploads: true,
  } as const;
  supportedEventTypes = ['message.post', 'file.upload'] as const satisfies readonly CoreBotEventType[];

  async handleEvent(event: CoreBotEvent, runtime: BotEventRuntime): Promise<boolean> {
    if (event.provider !== this.providerId) {
      return false;
    }
    const bot = runtime.telegramBot;
    if (!bot) {
      logger.warn({ event }, 'Telegram bot event received without Telegram runtime');
      return false;
    }

    switch (event.type) {
      case 'message.post': {
        const chatId = parseChatId(event.payload.channelId);
        await bot.api.sendMessage(chatId, event.payload.text, {
          ...(event.payload.threadId
            ? { reply_parameters: { message_id: Number.parseInt(event.payload.threadId, 10) } }
            : {}),
        });
        return true;
      }
      case 'file.upload': {
        const chatId = parseChatId(event.payload.channelId);
        const { InputFile } = await import('grammy');
        const document =
          'filePath' in event.payload
            ? new InputFile(event.payload.filePath)
            : new InputFile(Buffer.from(event.payload.fileContent, 'utf8'), event.payload.title);
        await bot.api.sendDocument(chatId, document, {
          caption: event.payload.title,
          ...(event.payload.threadId
            ? { reply_parameters: { message_id: Number.parseInt(event.payload.threadId, 10) } }
            : {}),
        });
        return true;
      }
      default:
        return false;
    }
  }
}
