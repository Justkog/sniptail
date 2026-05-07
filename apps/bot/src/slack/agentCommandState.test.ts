import { describe, expect, it } from 'vitest';
import { buildSlackAgentQuestionRequestText } from './agentCommandState.js';

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
