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

  it('posts one batch after the debounce interval', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    await vi.advanceTimersByTimeAsync(999);
    expect(notifier.postMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(notifier.postMessage).toHaveBeenCalledWith(ref, 'OpenCode tool running: bash');
  });

  it('groups multiple lines, prefixes errors, and dedupes consecutive identical lines', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    buffer.push('OpenCode tool running: bash');
    buffer.push('OpenCode tool error: bash: failed', { isError: true });
    await buffer.flush();

    expect(notifier.postMessage).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenCalledWith(
      ref,
      ['OpenCode tool running: bash', 'Error: OpenCode tool error: bash: failed'].join('\n'),
    );
  });

  it('does not post empty batches', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('   ');
    await buffer.flush();

    expect(notifier.postMessage).not.toHaveBeenCalled();
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
    await buffer.flush();

    expect(notifier.postMessage).toHaveBeenCalledTimes(2);
    for (const call of notifier.postMessage.mock.calls) {
      expect(String(call[1]).length).toBeLessThanOrEqual(50);
    }
  });

  it('cancels timers on close', async () => {
    const notifier = buildNotifier();
    const buffer = createDebouncedAgentOutputBuffer({ notifier, ref, debounceMs: 1_000 });

    buffer.push('OpenCode tool running: bash');
    buffer.close();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(notifier.postMessage).not.toHaveBeenCalled();
  });
});
