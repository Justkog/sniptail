import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { runCopilot } from './copilot.js';

type MockSession = {
  sessionId: string;
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  sendAndWait: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const hoisted = vi.hoisted(() => {
  const clientCtor = vi.fn();
  const start = vi.fn<() => Promise<void>>();
  const stop = vi.fn<() => Promise<unknown[]>>();
  const forceStop = vi.fn<() => Promise<void>>();
  const createSession = vi.fn<(options?: unknown) => Promise<MockSession>>();
  const resumeSession = vi.fn<(sessionId: string, options?: unknown) => Promise<MockSession>>();
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

    resumeSession(sessionId: string, options?: unknown): Promise<MockSession> {
      return resumeSession(sessionId, options);
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
    send: vi.fn().mockResolvedValue('message-1'),
    sendAndWait,
    abort: vi.fn().mockResolvedValue(undefined),
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
      300_000,
    );
    const createSessionFirstCall = hoisted.createSession.mock.calls[0];
    expect(createSessionFirstCall).toBeDefined();
    const createSessionOptions = createSessionFirstCall?.[0] as
      | { onPermissionRequest?: unknown }
      | undefined;
    expect(typeof createSessionOptions?.onPermissionRequest).toBe('function');
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
      300_000,
    );
    expect(secondSendAndWait).toHaveBeenCalledWith(
      {
        prompt: 'continue prompt',
        attachments: [{ type: 'file', path: 'context/diagram.png', displayName: 'diagram.png' }],
      },
      300_000,
    );
    const resumeSessionFirstCall = hoisted.resumeSession.mock.calls[0];
    expect(resumeSessionFirstCall).toBeDefined();
    expect(resumeSessionFirstCall?.[0]).toBe('session-1');
    const resumeSessionOptions = resumeSessionFirstCall?.[1] as
      | { onPermissionRequest?: unknown }
      | undefined;
    expect(typeof resumeSessionOptions?.onPermissionRequest).toBe('function');
  });

  it('passes the configured Copilot agent and streaming flag into new sessions', async () => {
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
        copilot: {
          agent: 'reviewer',
          streaming: true,
        },
        model: 'gpt-5.5',
        modelReasoningEffort: 'high',
      },
    );

    expect(hoisted.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'reviewer',
        streaming: true,
        model: 'gpt-5.5',
        reasoningEffort: 'high',
      }),
    );
  });

  it('passes custom permission and user input handlers into new sessions', async () => {
    const sendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    const onPermissionRequest = vi.fn();
    const onUserInputRequest = vi.fn();
    hoisted.createSession.mockResolvedValue(createSessionMock(sendAndWait));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        copilot: {
          onPermissionRequest,
          onUserInputRequest,
        },
      },
    );

    expect(hoisted.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        onPermissionRequest,
        onUserInputRequest,
      }),
    );
  });

  it('passes the configured Copilot agent and streaming flag into resumed sessions', async () => {
    const sendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    hoisted.resumeSession.mockResolvedValue(createSessionMock(sendAndWait, 'session-9'));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        resumeThreadId: 'session-9',
        copilot: {
          agent: 'reviewer',
          streaming: true,
        },
      },
    );

    expect(hoisted.resumeSession).toHaveBeenCalledWith(
      'session-9',
      expect.objectContaining({
        agent: 'reviewer',
        streaming: true,
      }),
    );
  });

  it('passes custom permission and user input handlers into resumed sessions', async () => {
    const sendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    const onPermissionRequest = vi.fn();
    const onUserInputRequest = vi.fn();
    hoisted.resumeSession.mockResolvedValue(createSessionMock(sendAndWait, 'session-9'));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        resumeThreadId: 'session-9',
        copilot: {
          onPermissionRequest,
          onUserInputRequest,
        },
      },
    );

    expect(hoisted.resumeSession).toHaveBeenCalledWith(
      'session-9',
      expect.objectContaining({
        onPermissionRequest,
        onUserInputRequest,
      }),
    );
  });

  it('passes a custom Copilot idle timeout to sendAndWait', async () => {
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
        copilotIdleTimeoutMs: 1_800_000,
      },
    );

    expect(sendAndWait).toHaveBeenCalledWith(
      {
        prompt: 'mock prompt',
      },
      1_800_000,
    );
  });

  it('publishes active session runtime after creating a session', async () => {
    const sendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    const session = createSessionMock(sendAndWait, 'session-1');
    const onSessionReady = vi.fn();
    hoisted.createSession.mockResolvedValue(session);

    await runCopilot(buildJob('ASK'), '/tmp/work', {}, { copilot: { onSessionReady } });

    expect(onSessionReady).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
      }),
    );
    const runtime = onSessionReady.mock.calls[0]?.[0] as
      | {
          abort: () => Promise<void>;
          sendImmediate: (message: string) => Promise<void>;
          enqueue: (message: string) => Promise<void>;
        }
      | undefined;
    await runtime?.abort();
    await runtime?.sendImmediate('steer');
    await runtime?.enqueue('later');

    expect(session.abort).toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledWith({ prompt: 'steer', mode: 'immediate' });
    expect(session.send).toHaveBeenCalledWith({ prompt: 'later', mode: 'enqueue' });
  });

  it('refreshes active session runtime after idle-timeout resume', async () => {
    const firstSendAndWait = vi.fn().mockRejectedValue(new Error('session.idle'));
    const secondSendAndWait = vi.fn().mockResolvedValue({
      type: 'assistant.message',
      data: { content: 'done' },
    });
    const onSessionReady = vi.fn();
    hoisted.createSession.mockResolvedValue(createSessionMock(firstSendAndWait, 'session-1'));
    hoisted.resumeSession.mockResolvedValue(createSessionMock(secondSendAndWait, 'session-2'));

    await runCopilot(
      buildJob('ASK'),
      '/tmp/work',
      {},
      {
        copilot: { onSessionReady },
        copilotIdleRetries: 1,
      },
    );

    expect(onSessionReady).toHaveBeenCalledTimes(2);
    expect(onSessionReady.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-1' });
    expect(onSessionReady.mock.calls[1]?.[0]).toMatchObject({ sessionId: 'session-2' });
  });
});
