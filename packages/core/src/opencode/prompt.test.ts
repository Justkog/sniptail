import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';
import { abortOpenCodeSession, runOpenCode, runOpenCodePrompt } from './prompt.js';

const hoisted = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
  createOpencodeServer: vi.fn(),
  serverClose: vi.fn(),
  client: {
    session: {
      abort: vi.fn(),
      create: vi.fn(),
      message: vi.fn(),
      prompt: vi.fn(),
      messages: vi.fn(),
    },
    event: {
      subscribe: vi.fn(),
    },
    config: {
      get: vi.fn(),
    },
  },
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: hoisted.createOpencodeClient,
  createOpencodeServer: hoisted.createOpencodeServer,
}));

function buildJob(): JobSpec {
  return {
    jobId: 'job-1',
    type: 'ASK',
    repoKeys: ['repo-1'],
    gitRef: 'main',
    requestText: 'answer this',
    channel: {
      provider: 'slack',
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

async function* emptyEvents() {
  await Promise.resolve();
  if (Date.now() < 0) yield undefined as never;
}

async function* eventsSequence(events: unknown[]) {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

describe('OpenCode prompt helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createOpencodeServer.mockResolvedValue({
      url: 'http://127.0.0.1:4096',
      close: hoisted.serverClose,
    });
    hoisted.createOpencodeClient.mockReturnValue(hoisted.client);
    hoisted.client.session.create.mockResolvedValue({ data: { id: 'session-1' } });
    hoisted.client.session.abort.mockResolvedValue({ data: true });
    hoisted.client.session.message.mockResolvedValue({ data: { parts: [] } });
    hoisted.client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: 'text', text: 'done' }] },
    });
    hoisted.client.session.messages.mockResolvedValue({ data: [] });
    hoisted.client.event.subscribe.mockResolvedValue({ stream: emptyEvents() });
    hoisted.client.config.get.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a freeform prompt and reports the OpenCode session id immediately', async () => {
    const onSessionId = vi.fn();
    const onRuntimeReady = vi.fn();

    const result = await runOpenCodePrompt(
      'inspect this repo',
      '/tmp/work',
      {},
      { onRuntimeReady, onSessionId },
    );

    expect(result).toEqual({ finalResponse: 'done', threadId: 'session-1' });
    expect(onSessionId).toHaveBeenCalledWith('session-1');
    expect(onRuntimeReady).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      executionMode: 'local',
      sessionId: 'session-1',
    });
    expect(hoisted.client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'session-1',
        directory: '/tmp/work',
        parts: [{ type: 'text', text: 'inspect this repo' }],
      }),
    );
  });

  it('streams assistant text from message part updates', async () => {
    const onAssistantMessage = vi.fn();
    hoisted.client.session.prompt.mockImplementationOnce(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
      return { data: { parts: [{ type: 'text', text: 'done' }] } };
    });
    hoisted.client.event.subscribe.mockResolvedValue({
      stream: eventsSequence([
        {
          type: 'message.updated',
          properties: {
            info: {
              id: 'message-1',
              sessionID: 'session-1',
              role: 'assistant',
              time: {},
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'assistant text',
            },
          },
        },
      ]),
    });

    await runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });

    expect(onAssistantMessage).toHaveBeenCalledWith(
      'assistant text',
      expect.objectContaining({ type: 'message.part.updated' }),
    );
    expect(hoisted.client.session.message).not.toHaveBeenCalled();
  });

  it('streams assistant text from wrapped payload events', async () => {
    const onAssistantMessage = vi.fn();
    hoisted.client.session.prompt.mockImplementationOnce(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
      return { data: { parts: [{ type: 'text', text: 'done' }] } };
    });
    hoisted.client.event.subscribe.mockResolvedValue({
      stream: eventsSequence([
        {
          type: 'event',
          properties: {
            payload: {
              type: 'message.updated',
              properties: {
                info: {
                  id: 'message-1',
                  sessionID: 'session-1',
                  role: 'assistant',
                  time: {},
                },
              },
            },
          },
        },
        {
          type: 'event',
          properties: {
            payload: {
              type: 'message.part.updated',
              properties: {
                part: {
                  id: 'part-1',
                  sessionID: 'session-1',
                  messageID: 'message-1',
                  type: 'text',
                  text: 'wrapped text',
                },
              },
            },
          },
        },
      ]),
    });

    await runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });

    expect(onAssistantMessage).toHaveBeenCalledWith(
      'wrapped text',
      expect.objectContaining({ type: 'message.part.updated' }),
    );
  });

  it('emits only appended text from repeated full text snapshots', async () => {
    const onAssistantMessage = vi.fn();
    hoisted.client.session.prompt.mockImplementationOnce(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
      return { data: { parts: [{ type: 'text', text: 'done' }] } };
    });
    hoisted.client.event.subscribe.mockResolvedValue({
      stream: eventsSequence([
        {
          type: 'message.updated',
          properties: {
            info: {
              id: 'message-1',
              sessionID: 'session-1',
              role: 'assistant',
              time: {},
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'hello',
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'hello',
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'hello world',
            },
          },
        },
      ]),
    });

    await runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });

    expect(onAssistantMessage.mock.calls.map(([text]) => text as string)).toEqual([
      'hello',
      ' world',
    ]);
  });

  it('ignores text parts for non-assistant or unknown message roles', async () => {
    const onAssistantMessage = vi.fn();
    hoisted.client.session.prompt.mockImplementationOnce(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
      return { data: { parts: [{ type: 'text', text: 'done' }] } };
    });
    hoisted.client.event.subscribe.mockResolvedValue({
      stream: eventsSequence([
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-unknown',
              sessionID: 'session-1',
              messageID: 'message-unknown',
              type: 'text',
              text: 'unknown role',
            },
          },
        },
        {
          type: 'message.updated',
          properties: {
            info: {
              id: 'message-1',
              sessionID: 'session-1',
              role: 'user',
              time: {},
            },
          },
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-user',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'user text',
            },
          },
        },
      ]),
    });

    await runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });

    expect(onAssistantMessage).not.toHaveBeenCalled();
  });

  it('keeps completed assistant message roles briefly for late text parts', async () => {
    vi.useFakeTimers();
    const onAssistantMessage = vi.fn();
    let finishPrompt: () => void = () => {};
    hoisted.client.session.prompt.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishPrompt = resolve;
      });
      return { data: { parts: [{ type: 'text', text: 'done' }] } };
    });
    hoisted.client.event.subscribe.mockResolvedValue({
      stream: (async function* () {
        yield {
          type: 'message.updated',
          properties: {
            info: {
              id: 'message-1',
              sessionID: 'session-1',
              role: 'assistant',
              time: { completed: 123 },
            },
          },
        };
        yield {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'late',
            },
          },
        };
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 30_001));
        yield {
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-2',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'too late',
            },
          },
        };
      })(),
    });

    const run = runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });
    await vi.advanceTimersByTimeAsync(30_001);
    finishPrompt();
    await run;

    expect(onAssistantMessage.mock.calls.map(([text]) => text as string)).toEqual(['late']);
  });

  it('resumes a freeform prompt session and forwards the selected OpenCode agent', async () => {
    const onSessionId = vi.fn();

    const result = await runOpenCodePrompt(
      'continue',
      '/tmp/work',
      {},
      {
        sessionId: 'session-old',
        opencode: { agent: 'plan' },
        onSessionId,
      },
    );

    expect(result.threadId).toBe('session-old');
    expect(hoisted.client.session.create).not.toHaveBeenCalled();
    expect(onSessionId).toHaveBeenCalledWith('session-old');
    expect(hoisted.client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'session-old',
        agent: 'plan',
      }),
    );
  });

  it('aborts an OpenCode session through a supplied runtime URL', async () => {
    await abortOpenCodeSession('session-1', '/tmp/work', {}, { baseUrl: 'http://127.0.0.1:4096' });

    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
    });
    expect(hoisted.client.session.abort).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/work',
    });
  });

  it('aborts an OpenCode server-mode session through configured server URL', async () => {
    await abortOpenCodeSession(
      'session-1',
      '/tmp/work',
      { OPENCODE_AUTH_HEADER: 'Bearer secret' },
      {
        opencode: {
          executionMode: 'server',
          serverUrl: 'http://opencode.example',
          serverAuthHeaderEnv: 'OPENCODE_AUTH_HEADER',
        },
      },
    );

    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://opencode.example',
      directory: '/tmp/work',
      headers: { Authorization: 'Bearer secret' },
    });
    expect(hoisted.client.session.abort).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/work',
    });
  });

  it('reports OpenCode abort errors readably', async () => {
    hoisted.client.session.abort.mockResolvedValueOnce({ error: { name: 'NotFound' } });

    await expect(
      abortOpenCodeSession(
        'missing-session',
        '/tmp/work',
        {},
        { baseUrl: 'http://127.0.0.1:4096' },
      ),
    ).rejects.toThrow('OpenCode abort failed:');
  });

  it('reuses resumed session id and forwards provider/model, agent, and attachments', async () => {
    const result = await runOpenCode(
      buildJob(),
      '/tmp/work',
      {},
      {
        resumeThreadId: 'session-old',
        modelProvider: 'anthropic',
        model: 'claude-sonnet',
        opencode: { agent: 'build', variant: 'high' },
        currentTurnAttachments: [
          {
            path: '/tmp/work/context/file.txt',
            displayName: 'file.txt',
            mediaType: 'text/plain',
          },
        ],
      },
    );

    expect(result.threadId).toBe('session-old');
    expect(hoisted.client.session.create).not.toHaveBeenCalled();
    expect(hoisted.client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: 'session-old',
        directory: '/tmp/work',
        model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
        agent: 'build',
        variant: 'high',
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({
            type: 'file',
            mime: 'text/plain',
            filename: 'file.txt',
            url: 'file:///tmp/work/context/file.txt',
          }),
        ]) as unknown,
      }),
    );
  });

  it('falls back to session messages when prompt response has no text', async () => {
    hoisted.client.session.prompt.mockResolvedValue({ data: { parts: [] } });
    hoisted.client.session.messages.mockResolvedValue({
      data: [
        {
          info: { role: 'assistant' },
          parts: [{ type: 'text', text: 'fallback response' }],
        },
      ],
    });

    const result = await runOpenCode(buildJob(), '/tmp/work', {}, {});

    expect(result.finalResponse).toBe('fallback response');
    expect(hoisted.client.session.messages).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/tmp/work',
      limit: 20,
    });
  });
});
