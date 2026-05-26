import { describe, expect, it } from 'vitest';
import {
  buildSlackAgentQuestionRequestText,
  clearPendingSlackAgentSessionBrowserRequest,
  clearSlackAgentSessionsActionState,
  getPendingSlackAgentSessionBrowserRequest,
  getSlackAgentSessionsActionState,
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

describe('pending Slack agent session browser requests', () => {
  it('stores requestedAt and returns active pending browser requests', () => {
    setPendingSlackAgentSessionBrowserRequest(
      {
        requestId: 'request-active',
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: [],
      },
      1_000,
    );

    const pending = getPendingSlackAgentSessionBrowserRequest('request-active', 1_001);
    expect(pending?.requestId).toBe('request-active');
    expect(pending?.requestedAt).toBe(1_000);

    clearPendingSlackAgentSessionBrowserRequest('request-active');
  });

  it('evicts expired browser requests on lookup', () => {
    setPendingSlackAgentSessionBrowserRequest(
      {
        requestId: 'request-expired',
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: [],
        requestedAt: 1_000,
      },
      1_000,
    );

    const expiredAt = 1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1;
    expect(getPendingSlackAgentSessionBrowserRequest('request-expired', expiredAt)).toBeUndefined();
    expect(getPendingSlackAgentSessionBrowserRequest('request-expired', expiredAt)).toBeUndefined();
  });

  it('evicts expired browser requests before storing a new one', () => {
    setPendingSlackAgentSessionBrowserRequest(
      {
        requestId: 'request-old',
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: [],
        requestedAt: 1_000,
      },
      1_000,
    );

    const later = 1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1;
    setPendingSlackAgentSessionBrowserRequest(
      {
        requestId: 'request-new',
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        cursorHistory: [],
      },
      later,
    );

    expect(getPendingSlackAgentSessionBrowserRequest('request-old', later)).toBeUndefined();
    expect(getPendingSlackAgentSessionBrowserRequest('request-new', later)?.requestedAt).toBe(
      later,
    );

    clearPendingSlackAgentSessionBrowserRequest('request-new');
  });
});

describe('Slack agent session browser action tokens', () => {
  it('stores page action payloads behind short tokens', () => {
    const token = setSlackAgentSessionsActionState(
      {
        kind: 'next',
        payload: {
          channelId: 'channel-1',
          userId: 'user-1',
          workerId: 'worker-a',
          cursorHistory: ['cursor-1'],
          nextCursor: 'cursor-2',
        },
      },
      1_000,
    );

    expect(token).not.toContain('cursor-2');
    const state = getSlackAgentSessionsActionState(token, 1_001);
    expect(state?.kind).toBe('next');
    expect(state?.payload.nextCursor).toBe('cursor-2');

    clearSlackAgentSessionsActionState(token);
  });

  it('evicts expired action tokens', () => {
    const token = setSlackAgentSessionsActionState(
      {
        kind: 'attach',
        payload: {
          channelId: 'channel-1',
          userId: 'user-1',
          workerId: 'worker-a',
          provider: 'acp',
          providerSessionId: 'provider-session-1',
          sessionAgentProfileKey: 'build',
        },
      },
      1_000,
    );

    const expiredAt = 1_000 + SLACK_AGENT_SESSIONS_BROWSER_TTL_MS + 1;
    expect(getSlackAgentSessionsActionState(token, expiredAt)).toBeUndefined();
    expect(getSlackAgentSessionsActionState(token, expiredAt)).toBeUndefined();
  });
});
