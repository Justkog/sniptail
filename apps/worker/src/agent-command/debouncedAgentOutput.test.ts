import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notifier } from '../channels/notifier.js';
import { createDebouncedAgentOutputBuffer } from './debouncedAgentOutput.js';

function buildNotifier(): Notifier & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn(),
    addReaction: vi.fn(),
  };
}

const ref = {
  provider: 'discord',
  channelId: 'thread-1',
  threadId: 'thread-1',
} as const;

describe('debounced agent output buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the first line immediately and does not repost it after the debounce interval', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    await Promise.resolve();
    expect(notifier.postMessage).toHaveBeenCalledWith(ref, 'OpenCode tool running: bash');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(notifier.postMessage).toHaveBeenCalledTimes(1);
  });

  it('groups trailing lines after the immediate first flush, prefixes errors, and dedupes consecutive identical lines', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    buffer.push('OpenCode tool running: bash');
    buffer.push('OpenCode tool error: bash: failed', { isError: true });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(notifier.postMessage).toHaveBeenCalledTimes(2);
    expect(notifier.postMessage).toHaveBeenNthCalledWith(1, ref, 'OpenCode tool running: bash');
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      2,
      ref,
      'Error: OpenCode tool error: bash: failed',
    );
  });

  it('does not post empty batches', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('   ');
    await buffer.flush();

    expect(notifier.postMessage).not.toHaveBeenCalled();
  });

  it('preserves leading whitespace when requested', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push(' leading text', { preserveWhitespace: true });
    await buffer.flush();

    expect(notifier.postMessage).toHaveBeenCalledWith(ref, ' leading text');
  });

  it('splits large batches into multiple messages under the configured limit', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({
      notifier,
      ref,
      debounceMs: 1_000,
      maxMessageLength: 50,
    });

    buffer.push('a'.repeat(30));
    buffer.push('b'.repeat(30));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(notifier.postMessage).toHaveBeenCalledTimes(2);
    expect(notifier.postMessage).toHaveBeenNthCalledWith(1, ref, 'a'.repeat(30));
    for (const call of notifier.postMessage.mock.calls.slice(1)) {
      expect(String(call[1]).length).toBeLessThanOrEqual(50);
    }
  });

  it('flushes lines pushed while a previous flush is still posting', async () => {
    const notifier = buildNotifier();
    let releaseFirstPost: () => void = () => {};
    const firstPost = new Promise<void>((resolve) => {
      releaseFirstPost = resolve;
    });
    notifier.postMessage.mockReturnValueOnce(firstPost);
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('first');
    await Promise.resolve();
    expect(notifier.postMessage).toHaveBeenCalledTimes(1);

    buffer.push('second');
    const secondFlush = vi.advanceTimersByTimeAsync(1_000);
    releaseFirstPost();
    await secondFlush;
    await Promise.resolve();

    expect(notifier.postMessage).toHaveBeenNthCalledWith(1, ref, 'first');
    expect(notifier.postMessage).toHaveBeenNthCalledWith(2, ref, 'second');
  });

  it('cancels only the trailing timer on close', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    buffer.push('OpenCode tool finished: bash');
    await Promise.resolve();
    buffer.close();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(notifier.postMessage).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenCalledWith(ref, 'OpenCode tool running: bash');
  });
});
