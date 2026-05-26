import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSlackAgentQuestionRequestText,
  clearPendingSlackAgentQuestion,
  clearPendingSlackAgentSessionBrowserRequest,
  clearSlackAgentSessionsActionState,
  getPendingSlackAgentQuestion,
  getPendingSlackAgentSessionBrowserRequest,
  getSlackAgentSessionsActionState,
  setPendingSlackAgentQuestion,
  setPendingSlackAgentSessionBrowserRequest,
  setSlackAgentSessionsActionState,
  SLACK_AGENT_SESSIONS_BROWSER_TTL_MS,
} from './agentCommandState.js';

describe('buildSlackAgentQuestionRequestText', () => {
  it('omits numbering and header text for a single question without a header', () => {
    expect(
      buildSlackAgentQuestionRequestText({
        sessionId: 'session-1',
        interactionId: 'interaction-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        workspaceKey: 'snatch',
        expiresAt: '2026-01-01T00:30:00.000Z',
        questions: [
          {
            question: 'Pick one number for this test:',
            options: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
            multiple: false,
            custom: true,
          },
        ],
      }),
    ).toBe(
      [
        '*Question requested*',
        'Workspace: `snatch`',
        'Expires: 2026-01-01T00:30:00.000Z',
        '',
        'Pick one number for this test:',
        '• One',
        '• Two',
        '• Three',
        '_Custom answer allowed._',
      ].join('\n'),
    );
  });
});

describe('pending Slack agent questions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    clearPendingSlackAgentQuestion('session-1', 'interaction-1');
    vi.useRealTimers();
  });

  it('expires pending questions using the event expiresAt value', () => {
    setPendingSlackAgentQuestion({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      workspaceKey: 'snatch',
      expiresAt: '2026-01-01T00:01:00.000Z',
      questions: [
        {
          question: 'Pick one.',
          options: [{ label: 'One' }],
          multiple: false,
          custom: false,
        },
      ],
    });

    expect(getPendingSlackAgentQuestion('session-1', 'interaction-1')).toBeDefined();

    vi.setSystemTime(new Date('2026-01-01T00:01:00.001Z'));

    expect(getPendingSlackAgentQuestion('session-1', 'interaction-1')).toBeUndefined();
  });

  it('does not store already expired questions', () => {
    setPendingSlackAgentQuestion({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      workspaceKey: 'snatch',
      expiresAt: '2025-12-31T23:59:59.000Z',
      questions: [
        {
          question: 'Pick one.',
          options: [{ label: 'One' }],
          multiple: false,
          custom: false,
        },
      ],
    });

    expect(getPendingSlackAgentQuestion('session-1', 'interaction-1')).toBeUndefined();
  });
});

describe('pending Slack agent session browser requests', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores requestedAt and returns active pending browser requests', () => {
    vi.setSystemTime(1_000);
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-active',
      channelId: 'channel-1',
      userId: 'user-1',
      workerId: 'worker-a',
      cursorHistory: [],
    });

    const pending = getPendingSlackAgentSessionBrowserRequest('request-active');
    expect(pending?.requestId).toBe('request-active');
    expect(pending?.requestedAt).toBe(1_000);

    clearPendingSlackAgentSessionBrowserRequest('request-active');
  });

  it('evicts expired browser requests on lookup', () => {
    vi.setSystemTime(1_000);
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-expired',
      channelId: 'channel-1',
      userId: 'user-1',
      workerId: 'worker-a',
      cursorHistory: [],
      requestedAt: 1_000,
    });

    vi.setSystemTime(1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1);
    expect(getPendingSlackAgentSessionBrowserRequest('request-expired')).toBeUndefined();
    expect(getPendingSlackAgentSessionBrowserRequest('request-expired')).toBeUndefined();
  });

  it('evicts expired browser requests before storing a new one', () => {
    vi.setSystemTime(1_000);
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-old',
      channelId: 'channel-1',
      userId: 'user-1',
      workerId: 'worker-a',
      cursorHistory: [],
      requestedAt: 1_000,
    });

    const later = 1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1;
    vi.setSystemTime(later);
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-new',
      channelId: 'channel-1',
      userId: 'user-1',
      workerId: 'worker-a',
      cursorHistory: [],
    });

    expect(getPendingSlackAgentSessionBrowserRequest('request-old')).toBeUndefined();
    expect(getPendingSlackAgentSessionBrowserRequest('request-new')?.requestedAt).toBe(later);

    clearPendingSlackAgentSessionBrowserRequest('request-new');
  });
});

describe('Slack agent session browser action tokens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores page action payloads behind short tokens', () => {
    vi.setSystemTime(1_000);
    const token = setSlackAgentSessionsActionState({
      kind: 'next',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: ['cursor-1'],
        nextCursor: 'cursor-2',
      },
    });

    expect(token).not.toContain('cursor-2');
    const state = getSlackAgentSessionsActionState(token);
    expect(state?.kind).toBe('next');
    expect(state?.payload.nextCursor).toBe('cursor-2');

    clearSlackAgentSessionsActionState(token);
  });

  it('evicts expired action tokens', () => {
    vi.setSystemTime(1_000);
    const token = setSlackAgentSessionsActionState({
      kind: 'attach',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        provider: 'acp',
        providerSessionId: 'provider-session-1',
        sessionAgentProfileKey: 'build',
      },
    });

    vi.setSystemTime(1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1);
    expect(getSlackAgentSessionsActionState(token)).toBeUndefined();
    expect(getSlackAgentSessionsActionState(token)).toBeUndefined();
  });
});
