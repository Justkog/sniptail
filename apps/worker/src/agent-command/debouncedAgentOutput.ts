import type { ChannelRef } from '@sniptail/core/types/channel.js';
import { logger } from '@sniptail/core/logger.js';
import type { Notifier } from '../channels/notifier.js';

export type DebouncedAgentOutputBuffer = {
  push(text: string, options?: { isError?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
};

export type DebouncedAgentOutputOptions = {
  notifier: Notifier;
  ref: ChannelRef;
  debounceMs: number;
  header?: string;
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

export function createDebouncedAgentOutputBuffer({
  notifier,
  ref,
  debounceMs,
  maxMessageLength = DEFAULT_MAX_MESSAGE_LENGTH,
}: DebouncedAgentOutputOptions): DebouncedAgentOutputBuffer {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastLine: string | undefined;
  let flushChain = Promise.resolve();

  function clearScheduledFlush(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function scheduleFlush(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch((err) => {
        logger.warn({ err }, 'Failed to flush debounced agent output');
      });
    }, debounceMs);
  }

  async function flushNow(): Promise<void> {
    clearScheduledFlush();
    if (pending.length === 0) return;

    const lines = pending;
    pending = [];
    for (const message of buildMessages(lines, maxMessageLength)) {
      await notifier.postMessage(ref, message);
    }
  }

  function flush(): Promise<void> {
    flushChain = flushChain.then(flushNow, flushNow);
    return flushChain;
  }

  return {
    push(text, options = {}) {
      const line = normalizeLine(text, options.isError ?? false);
      if (!line || line === lastLine) return;
      lastLine = line;
      pending.push(line);
      scheduleFlush();
    },
    flush,
    close() {
      clearScheduledFlush();
    },
  };
}
