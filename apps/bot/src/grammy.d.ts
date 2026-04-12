declare module 'grammy' {
  export type MaybePromise<T> = T | Promise<T>;

  export type TelegramChat = {
    id: number | string;
    type: 'private' | 'group' | 'supergroup' | 'channel';
  };

  export type TelegramUser = {
    id: number;
    username?: string;
  };

  export type TelegramMessage = {
    message_id: number;
    text?: string;
  };

  export type TelegramCallbackQuery = {
    data?: string;
    message?: TelegramMessage;
  };

  export type ReplyParameters = {
    message_id: number;
  };

  export type InlineKeyboardButton = {
    text: string;
    callback_data: string;
  };

  export type InlineKeyboardMarkup = {
    inline_keyboard: InlineKeyboardButton[][];
  };

  export type SendMessageOptions = {
    reply_markup?: InlineKeyboardMarkup;
    reply_parameters?: ReplyParameters;
  };

  export type EditMessageTextOptions = {
    reply_markup?: InlineKeyboardMarkup;
  };

  export type SendDocumentOptions = {
    caption?: string;
    reply_parameters?: ReplyParameters;
  };

  export type BotInfo = {
    id: number;
    username?: string;
  };

  export type Context = {
    chat?: TelegramChat;
    from?: TelegramUser;
    msg?: TelegramMessage;
  };

  export type CommandContext = Context & {
    reply(text: string): Promise<TelegramMessage>;
  };

  export type CallbackQueryContext = Context & {
    callbackQuery?: TelegramCallbackQuery;
    answerCallbackQuery(): Promise<void>;
  };

  export type MessageTextContext = Context & {
    msg?: TelegramMessage & { text: string };
  };

  export type TelegramApi = {
    sendMessage(
      chatId: number | string,
      text: string,
      options?: SendMessageOptions,
    ): Promise<TelegramMessage>;
    editMessageText(
      chatId: number | string,
      messageId: number,
      text: string,
      options?: EditMessageTextOptions,
    ): Promise<unknown>;
    sendDocument(
      chatId: number | string,
      document: InputFile,
      options?: SendDocumentOptions,
    ): Promise<unknown>;
  };

  export class Bot {
    constructor(token: string);
    api: TelegramApi;
    botInfo?: BotInfo;
    init(): Promise<void>;
    start(options?: unknown): Promise<void>;
    stop(): void;
    command(command: string, handler: (ctx: CommandContext) => MaybePromise<void>): void;
    on(
      filter: 'callback_query:data',
      handler: (ctx: CallbackQueryContext) => MaybePromise<void>,
    ): void;
    on(filter: 'message:text', handler: (ctx: MessageTextContext) => MaybePromise<void>): void;
    catch(handler: (error: unknown) => MaybePromise<void>): void;
  }

  export class InputFile {
    constructor(data: string | Uint8Array | Buffer, filename?: string);
  }
}
