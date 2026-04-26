import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { runCopilot } from './copilot.js';

type MockSession = {
  sessionId: string;
  on: ReturnType<typeof vi.fn>;
  sendAndWait: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const hoisted = vi.hoisted(() => {
  const clientCtor = vi.fn();
  const start = vi.fn<() => Promise<void>>();
  const stop = vi.fn<() => Promise<unknown[]>>();
  const forceStop = vi.fn<() => Promise<void>>();
  const createSession = vi.fn<(options?: unknown) => Promise<MockSession>>();
  const resumeSession = vi.fn<(sessionId: string) => Promise<MockSession>>();
  const buildPromptForJob = vi.fn<() => string>(() => 'mock prompt');

  class CopilotClientMock {
    constructor(options: unknown) {
      clientCtor(options);
    }

    start(): Promise<void> {
      return start();
    }

    stop(): Promise<unknown[]> {
      return stop();
    }

    forceStop(): Promise<void> {
      return forceStop();
    }

    createSession(options: unknown): Promise<MockSession> {
      return createSession(options);
    }

    resumeSession(sessionId: string): Promise<MockSession> {
      return resumeSession(sessionId);
    }
  }

  return {
    CopilotClientMock,
    clientCtor,
    start,
    stop,
    forceStop,
    createSession,
    resumeSession,
    buildPromptForJob,
  };
});

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: hoisted.CopilotClientMock,
  approveAll: () => true,
}));

vi.mock('../agents/buildPrompt.js', () => ({
  buildPromptForJob: hoisted.buildPromptForJob,
}));

vi.mock('../logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('./prompts/continue.md?raw', () => ({
  default: 'continue prompt',
}));

function buildJob(type: JobSpec['type']): JobSpec {
  return {
    jobId: 'job-1',
    type,
    repoKeys: ['repo-one'],
    gitRef: 'main',
    requestText: 'test request',
    channel: {
      provider: 'slack',
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

function createSessionMock(
  sendAndWait: ReturnType<typeof vi.fn>,
  sessionId = 'session-1',
): MockSession {
  return {
    sessionId,
    on: vi.fn(() => () => undefined),
    sendAndWait,
    destroy: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runCopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.start.mockResolvedValue(undefined);
    hoisted.stop.mockResolvedValue([]);
    hoisted.forceStop.mockResolvedValue(undefined);
  });

  it('passes current-turn files as Copilot attachments', async () => {
    const sendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    hoisted.createSession.mockResolvedValue(createSessionMock(sendAndWait));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        currentTurnAttachments: [
          {
            path: 'context/diagram.png',
            displayName: 'diagram.png',
            mediaType: 'image/png',
          },
          {
            path: 'context/notes.md',
            displayName: 'notes.md',
            mediaType: 'text/markdown',
          },
        ],
      },
    );

    expect(sendAndWait).toHaveBeenCalledWith(
      {
        prompt: 'mock prompt',
        attachments: [
          { type: 'file', path: 'context/diagram.png', displayName: 'diagram.png' },
          { type: 'file', path: 'context/notes.md', displayName: 'notes.md' },
        ],
      },
      300000,
    );
  });

  it('reuses the same current-turn attachments on idle-timeout retry', async () => {
    const firstSendAndWait = vi.fn().mockRejectedValue(new Error('session.idle'));
    const secondSendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    hoisted.createSession.mockResolvedValue(createSessionMock(firstSendAndWait, 'session-1'));
    hoisted.resumeSession.mockResolvedValue(createSessionMock(secondSendAndWait, 'session-1'));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        currentTurnAttachments: [
          {
            path: 'context/diagram.png',
            displayName: 'diagram.png',
            mediaType: 'image/png',
          },
        ],
        copilotIdleRetries: 1,
      },
    );

    expect(firstSendAndWait).toHaveBeenCalledWith(
      {
        prompt: 'mock prompt',
        attachments: [{ type: 'file', path: 'context/diagram.png', displayName: 'diagram.png' }],
      },
      300000,
    );
    expect(secondSendAndWait).toHaveBeenCalledWith(
      {
        prompt: 'continue prompt',
        attachments: [{ type: 'file', path: 'context/diagram.png', displayName: 'diagram.png' }],
      },
      300000,
    );
  });
});
