declare module 'grammy' {
  export class Bot<C = any> {
    constructor(token: string);
    api: any;
    botInfo?: {
      id: number;
      username?: string;
    };
    init(): Promise<void>;
    start(options?: unknown): Promise<void>;
    stop(): void;
    command(command: string, handler: (ctx: C) => unknown): void;
    on(filter: string, handler: (ctx: C) => unknown): void;
    catch(handler: (error: unknown) => unknown): void;
  }

  export class InlineKeyboard {
    text(label: string, data: string): this;
    row(): this;
  }

  export class InputFile {
    constructor(data: string | Uint8Array | Buffer, filename?: string);
  }
}
