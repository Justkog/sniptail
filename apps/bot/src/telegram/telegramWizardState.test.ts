import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTelegramWizardState,
  loadTelegramWizardState,
  saveTelegramWizardState,
} from './state.js';

describe('Telegram wizard state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  });

  afterEach(() => {
    clearTelegramWizardState('chat-1', 'user-1');
    vi.useRealTimers();
  });

  it('expires saved wizard state by ttl without interval cleanup', () => {
    vi.setSystemTime(1_000);
    saveTelegramWizardState('chat-1', 'user-1', {
      type: 'ASK',
      step: 'request',
      promptMessageId: 42,
      startedAt: 1_000,
    });

    expect(loadTelegramWizardState('chat-1', 'user-1')?.promptMessageId).toBe(42);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(loadTelegramWizardState('chat-1', 'user-1')).toBeUndefined();
  });
});
