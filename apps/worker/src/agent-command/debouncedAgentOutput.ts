import type { ChannelRef } from '@sniptail/core/types/channel.js';
import { logger } from '@sniptail/core/logger.js';
import type { Notifier } from '../channels/notifier.js';

export type DebouncedAgentOutputOptions = {
  notifier: Notifier;
  ref: ChannelRef;
  debounceMs: number;
  maxMessageLength?: number;
};

const DEFAULT_MAX_MESSAGE_LENGTH = 1900;

function normalizeLine(text: string, isError: boolean): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return isError ? `Error: ${trimmed}` : trimmed;
}

function splitLongLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxLength) {
    chunks.push(line.slice(index, index + maxLength));
  }
  return chunks;
}

function buildMessages(lines: string[], maxMessageLength: number): string[] {
  const lineLimit = Math.max(1, maxMessageLength);
  const messages: string[] = [];
  let current = '';

  for (const originalLine of lines) {
    for (const line of splitLongLine(originalLine, lineLimit)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length <= maxMessageLength) {
        current = candidate;
        continue;
      }
      if (current) {
        messages.push(current);
      }
      current = line;
    }
  }

  if (current) {
    messages.push(current);
  }
  return messages;
}

function takePendingLines(pending: string[]): string[] {
  const lines = [...pending];
  pending.length = 0;
  return lines;
}

export class DebouncedAgentOutputBuffer {
  private readonly notifier: Notifier;
  private readonly ref: ChannelRef;
  private readonly debounceMs: number;
  private readonly maxMessageLength: number;
  private readonly pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastLine: string | undefined;
  private flushQueue = Promise.resolve();

  constructor({
    notifier,
    ref,
    debounceMs,
    maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH,
  }: DebouncedAgentOutputOptions) {
    this.notifier = notifier;
    this.ref = ref;
    this.debounceMs = debounceMs;
    this.maxMessageLength = maxMessageLength;
  }

  push(text: string, options: { isError?: boolean } = {}): void {
    const line = normalizeLine(text, options.isError ?? false);
    if (!line || line === this.lastLine) return;
    this.lastLine = line;
    this.pending.push(line);
    this.scheduleFlush();
  }

  flush(): Promise<void> {
    // Serialize flushes so lines pushed during an in-flight post wait for the next flush.
    this.flushQueue = this.flushQueue.then(
      () => this.flushNow(),
      () => this.flushNow(),
    );
    return this.flushQueue;
  }

  close(): void {
    this.clearScheduledFlush();
  }

  private clearScheduledFlush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((err) => {
        logger.warn({ err }, 'Failed to flush debounced agent output');
      });
    }, this.debounceMs);
  }

  private async flushNow(): Promise<void> {
    this.clearScheduledFlush();
    if (this.pending.length === 0) return;

    await this.postLines(takePendingLines(this.pending));
  }

  private async postLines(lines: string[]): Promise<void> {
    for (const message of buildMessages(lines, this.maxMessageLength)) {
      await this.notifier.postMessage(this.ref, message);
    }
  }
}

export function createDebouncedAgentOutputBuffer(
  options: DebouncedAgentOutputOptions,
): DebouncedAgentOutputBuffer {
  return new DebouncedAgentOutputBuffer(options);
}
