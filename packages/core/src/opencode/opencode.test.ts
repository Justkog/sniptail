import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '../types/job.js';

const hoisted = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
  createOpencodeServer: vi.fn(),
  spawn: vi.fn(),
  resolveWorkerAgentScriptPath: vi.fn(() => '/tmp/opencode-docker-server.sh'),
  serverClose: vi.fn(),
  client: {
    session: {
      create: vi.fn(),
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

import { runOpenCode } from './opencode.js';

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
    hoisted.client.session.prompt.mockResolvedValue({
      data: { parts: [{ type: 'text', text: 'done' }] },
    });
    hoisted.client.session.messages.mockResolvedValue({ data: [] });
    hoisted.client.event.subscribe.mockResolvedValue({ stream: emptyEvents() });
    hoisted.client.config.get.mockResolvedValue({ data: {} });
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

    const result = await runOpenCode(
      buildJob(),
      '/tmp/work',
      {},
      {
        opencode: {
          executionMode: 'docker',
          startupTimeoutMs: 1_000,
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
  });
});
