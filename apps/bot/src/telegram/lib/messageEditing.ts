import type { Bot } from 'grammy';
import type {
  ForceReply,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from 'grammy/types';

type TelegramReplyMarkup =
  | ForceReply
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove;

export async function editTelegramMessage(
  bot: Bot,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  await bot.api.editMessageText(chatId, messageId, text, {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendTelegramMessage(
  bot: Bot,
  chatId: string,
  text: string,
  replyMarkup?: TelegramReplyMarkup,
  replyToMessageId?: number,
): Promise<number | undefined> {
  const message = await bot.api.sendMessage(chatId, text, {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  return message?.message_id;
}
