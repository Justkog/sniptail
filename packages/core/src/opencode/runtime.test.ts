import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDockerRuntime, createLocalRuntime, createServerRuntime } from './runtime.js';

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

describe('OpenCode runtime helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createOpencodeServer.mockResolvedValue({
      url: 'http://127.0.0.1:4096',
      close: hoisted.serverClose,
    });
    hoisted.createOpencodeClient.mockReturnValue(hoisted.client);
    hoisted.client.config.get.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and closes a local SDK-managed server', async () => {
    const runtime = await createLocalRuntime('/tmp/work', { botName: 'Sniptail' });

    expect(runtime.baseUrl).toBe('http://127.0.0.1:4096');
    expect(runtime.client).toBe(hoisted.client);
    expect(typeof runtime.close).toBe('function');
    expect(hoisted.createOpencodeServer).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: '127.0.0.1', timeout: 10_000 }),
    );
    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
    });

    await runtime.close();
    expect(hoisted.serverClose).toHaveBeenCalled();
  });

  it('connects to a configured server with auth header env', () => {
    const runtime = createServerRuntime(
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

    expect(runtime.baseUrl).toBe('http://opencode.example');
    expect(runtime.client).toBe(hoisted.client);
    expect(typeof runtime.close).toBe('function');
    expect(hoisted.createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://opencode.example',
      directory: '/tmp/work',
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('starts docker wrapper and cleans it up', async () => {
    const proc = buildChildProcess();
    hoisted.spawn.mockReturnValue(proc);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const runtime = await createDockerRuntime(
      'job-1',
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

    expect(runtime.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
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

    proc.stdout.emit('data', 'stdout line\n');
    proc.stderr.emit('data', 'stderr line\n');
    expect(stdoutSpy).toHaveBeenCalledWith('stdout line\n');
    expect(stderrSpy).toHaveBeenCalledWith('stderr line\n');

    await runtime.close();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
