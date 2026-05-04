import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';

const hoisted = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
  createOpencodeServer: vi.fn(),
  spawn: vi.fn(),
  resolveWorkerAgentScriptPath: vi.fn(() => '/tmp/opencode-docker-server.sh'),
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

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    spawn: hoisted.spawn,
  };
});

vi.mock('../agents/resolveWorkerAgentScriptPath.js', () => ({
  resolveWorkerAgentScriptPath: hoisted.resolveWorkerAgentScriptPath,
}));

import {
  abortOpenCodeSession,
  fetchCompletedAssistantMessageText,
  runOpenCode,
  runOpenCodePrompt,
} from './opencode.js';

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

function buildChildProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.kill = vi.fn();
  return proc;
}

describe('runOpenCode', () => {
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

  it('starts and closes a local SDK-managed server', async () => {
    const result = await runOpenCode(buildJob(), '/tmp/work', {}, { botName: 'Sniptail' });

    expect(result).toEqual({ finalResponse: 'done', threadId: 'session-1' });
    expect(hoisted.createOpencodeServer).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: '127.0.0.1', timeout: 10_000 }),
    );
    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
    });
    expect(hoisted.serverClose).toHaveBeenCalled();
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

  it('fetches completed assistant message text from message.updated events', async () => {
    hoisted.client.session.message.mockResolvedValue({
      data: {
        info: { id: 'message-1', role: 'assistant' },
        parts: [{ type: 'text', text: 'completed assistant text' }],
      },
    });

    const text = await fetchCompletedAssistantMessageText(hoisted.client, {
      type: 'message.updated',
      properties: {
        info: {
          id: 'message-1',
          sessionID: 'session-1',
          role: 'assistant',
          time: { completed: 123 },
        },
      },
    });

    expect(text).toBe('completed assistant text');
    expect(hoisted.client.session.message).toHaveBeenCalledWith({
      sessionID: 'session-1',
      messageID: 'message-1',
    });
  });

  it('ignores message updates that are not completed assistant messages', async () => {
    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'assistant',
            time: {},
          },
        },
      }),
    ).resolves.toBe('');
    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'user',
            time: { completed: 123 },
          },
        },
      }),
    ).resolves.toBe('');
    expect(hoisted.client.session.message).not.toHaveBeenCalled();
  });

  it('returns empty text when the completed assistant message has no text parts', async () => {
    hoisted.client.session.message.mockResolvedValue({
      data: {
        info: { id: 'message-1', role: 'assistant' },
        parts: [{ type: 'tool', tool: 'bash' }],
      },
    });

    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'assistant',
            time: { completed: 123 },
          },
        },
      }),
    ).resolves.toBe('');
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

  it('uses message part deltas directly', async () => {
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
            delta: 'hello',
            part: {
              id: 'part-1',
              sessionID: 'session-1',
              messageID: 'message-1',
              type: 'text',
              text: 'ignored snapshot',
            },
          },
        },
      ]),
    });

    await runOpenCodePrompt('inspect this repo', '/tmp/work', {}, { onAssistantMessage });

    expect(onAssistantMessage).toHaveBeenCalledTimes(1);
    expect(onAssistantMessage).toHaveBeenCalledWith(
      'hello',
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

  it('connects to a configured server with auth header env', async () => {
    await runOpenCode(
      buildJob(),
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

    expect(hoisted.createOpencodeServer).not.toHaveBeenCalled();
    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://opencode.example',
      directory: '/tmp/work',
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('aborts an OpenCode session through a supplied runtime URL', async () => {
    await abortOpenCodeSession('session-1', '/tmp/work', {}, { baseUrl: 'http://127.0.0.1:4096' });

    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      headers: {},
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
        opencode: { agent: 'build' },
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

  it('starts docker wrapper and cleans it up', async () => {
    const proc = buildChildProcess();
    hoisted.spawn.mockReturnValue(proc);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await runOpenCode(
      buildJob(),
      '/tmp/work',
      {},
      {
        opencode: {
          executionMode: 'docker',
          startupTimeoutMs: 1_000,
          dockerStreamLogs: true,
          docker: {
            enabled: true,
            dockerfilePath: './Dockerfile.opencode',
            image: 'snatch-opencode:local',
            buildContext: '.',
          },
        },
        additionalDirectories: ['/tmp/repos'],
      },
    );

    expect(result.finalResponse).toBe('done');
    expect(hoisted.resolveWorkerAgentScriptPath).toHaveBeenCalledWith('opencode-docker-server.sh');
    expect(hoisted.spawn).toHaveBeenCalledWith(
      '/tmp/opencode-docker-server.sh',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCODE_DOCKERFILE_PATH: expect.stringContaining('Dockerfile.opencode') as unknown,
          OPENCODE_DOCKER_IMAGE: 'snatch-opencode:local',
          OPENCODE_DOCKER_BUILD_CONTEXT: expect.any(String) as unknown,
          OPENCODE_DOCKER_WORKDIR: '/tmp/work',
          OPENCODE_DOCKER_ADDITIONAL_DIRS: '/tmp/repos',
        }) as unknown,
      }),
    );
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    proc.stdout.emit('data', 'stdout line\n');
    proc.stderr.emit('data', 'stderr line\n');
    expect(stdoutSpy).toHaveBeenCalledWith('stdout line\n');
    expect(stderrSpy).toHaveBeenCalledWith('stderr line\n');
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
