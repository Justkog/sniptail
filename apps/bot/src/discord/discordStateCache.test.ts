import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCORD_AGENT_SESSIONS_STATE_TTL_MS,
  DISCORD_SELECTION_TTL_MS,
  askSelectionByUser,
  getActiveDiscordSelection,
  getDiscordAgentSessionsActionState,
  getPendingDiscordAgentSessionBrowserRequest,
  setDiscordAgentSessionsActionState,
  setPendingDiscordAgentSessionBrowserRequest,
} from './state.js';

describe('Discord state caches', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    askSelectionByUser.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns expired selections once for selector cleanup flows', () => {
    vi.setSystemTime(1_000);
    askSelectionByUser.set('user-1', {
      repoKeys: ['repo-a'],
      requestedAt: 1_000,
      selectorMessageId: 'message-1',
    });

    vi.setSystemTime(1_000 + DISCORD_SELECTION_TTL_MS + 1);

    expect(getActiveDiscordSelection(askSelectionByUser, 'user-1')).toEqual({
      expiredSelection: {
        repoKeys: ['repo-a'],
        requestedAt: 1_000,
        selectorMessageId: 'message-1',
      },
    });
    expect(getActiveDiscordSelection(askSelectionByUser, 'user-1')).toEqual({});
  });

  it('expires pending browser requests and action tokens by ttl', () => {
    vi.setSystemTime(1_000);
    setPendingDiscordAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      interactionApplicationId: 'app-1',
      interactionToken: 'token-1',
      workerId: 'worker-a',
      cursorHistory: [],
      requestedAt: 1_000,
    });
    const actionToken = setDiscordAgentSessionsActionState({
      kind: 'next',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: [],
        nextCursor: 'cursor-2',
      },
    });

    vi.setSystemTime(1_000 + DISCORD_AGENT_SESSIONS_STATE_TTL_MS + 1);

    expect(getPendingDiscordAgentSessionBrowserRequest('request-1')).toBeUndefined();
    expect(getDiscordAgentSessionsActionState(actionToken)).toBeUndefined();
  });
});
