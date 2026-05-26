import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupe } from './lib/dedupe.js';

describe('Slack dedupe cache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forgets keys after the dedupe window expires', () => {
    vi.setSystemTime(1_000);

    expect(dedupe('dedupe-key-1')).toBe(false);
    expect(dedupe('dedupe-key-1')).toBe(true);

    vi.advanceTimersByTime(2 * 60 * 1000 + 1);

    expect(dedupe('dedupe-key-1')).toBe(false);
  });
});
