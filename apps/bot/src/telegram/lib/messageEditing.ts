import type { Bot } from 'grammy';

export async function editTelegramMessage(
  bot: Bot,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  await bot.api.editMessageText(chatId, messageId, text, {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendTelegramMessage(
  bot: Bot,
  chatId: string,
  text: string,
  replyMarkup?: unknown,
  replyToMessageId?: number,
): Promise<number | undefined> {
  const message = await bot.api.sendMessage(chatId, text, {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  return message?.message_id;
}
