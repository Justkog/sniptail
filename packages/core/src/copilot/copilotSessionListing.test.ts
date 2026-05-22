import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listCopilotSessions } from './copilotSessionListing.js';

const hoisted = vi.hoisted(() => {
  const clientCtor = vi.fn();
  const start = vi.fn<() => Promise<void>>();
  const stop = vi.fn<() => Promise<unknown[]>>();
  const forceStop = vi.fn<() => Promise<void>>();
  const listSessions = vi.fn<(filter?: unknown) => Promise<unknown[]>>();
  const execFile = vi.fn();
  const resolveWorkerAgentScriptPath = vi.fn(() => '/tmp/copilot-docker.sh');

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

    listSessions(filter?: unknown): Promise<unknown[]> {
      return listSessions(filter);
    }
  }

  return {
    CopilotClientMock,
    clientCtor,
    start,
    stop,
    forceStop,
    listSessions,
    execFile,
    resolveWorkerAgentScriptPath,
  };
});

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: hoisted.CopilotClientMock,
}));

vi.mock('node:child_process', () => ({
  execFile: hoisted.execFile,
}));

vi.mock('../agents/resolveWorkerAgentScriptPath.js', () => ({
  resolveWorkerAgentScriptPath: hoisted.resolveWorkerAgentScriptPath,
}));

describe('listCopilotSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.start.mockResolvedValue(undefined);
    hoisted.stop.mockResolvedValue([]);
    hoisted.forceStop.mockResolvedValue(undefined);
    hoisted.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        callback?: ((error: Error | null) => void) | undefined,
      ) => {
        callback?.(null);
      },
    );
  });

  it('starts the client, lists sessions with the provided filter, and stops cleanly', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T09:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        summary: 'Build session',
        isRemote: false,
        context: {
          cwd: '/tmp/repos/snatch/apps/worker',
        },
      },
    ];
    hoisted.listSessions.mockResolvedValue(sessions);

    await expect(
      listCopilotSessions({
        workDir: '/tmp/repos',
        env: {
          HOME: '/home/sniptail',
        },
        executionMode: 'local',
        filter: {
          cwd: '/tmp/repos/snatch/apps/worker',
          repository: 'sniptail/snatch',
        },
      }),
    ).resolves.toEqual(sessions);

    expect(hoisted.clientCtor).toHaveBeenCalledWith({
      cwd: '/tmp/repos',
      env: {
        HOME: '/home/sniptail',
      },
      autoRestart: false,
    });
    expect(hoisted.listSessions).toHaveBeenCalledWith({
      cwd: '/tmp/repos/snatch/apps/worker',
      repository: 'sniptail/snatch',
    });
    expect(hoisted.stop).toHaveBeenCalledTimes(1);
    expect(hoisted.forceStop).not.toHaveBeenCalled();
    expect(hoisted.execFile).not.toHaveBeenCalled();
  });

  it('uses the worker docker script and docker env when configured', async () => {
    hoisted.listSessions.mockResolvedValue([]);

    await listCopilotSessions({
      workDir: '/tmp/repos',
      env: {
        HOME: '/home/sniptail',
      },
      executionMode: 'docker',
      docker: {
        dockerfilePath: './Dockerfile.copilot',
        image: 'sniptail-copilot:local',
        buildContext: './docker',
      },
      filter: {
        branch: 'main',
      },
    });

    expect(hoisted.resolveWorkerAgentScriptPath).toHaveBeenCalledWith('copilot-docker.sh');
    expect(hoisted.clientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/repos',
        cliPath: '/tmp/copilot-docker.sh',
        autoRestart: false,
        env: expect.objectContaining({
          HOME: '/home/sniptail',
          GH_COPILOT_DOCKERFILE_PATH: expect.stringContaining('Dockerfile.copilot'),
          GH_COPILOT_DOCKER_IMAGE: 'sniptail-copilot:local',
          GH_COPILOT_DOCKER_BUILD_CONTEXT: expect.stringContaining('/docker'),
          GH_COPILOT_DOCKER_CONTAINER_NAME: expect.stringMatching(
            /^sniptail-copilot-list-/,
          ),
        }),
      }),
    );
    expect(hoisted.execFile).toHaveBeenNthCalledWith(
      1,
      'docker',
      [ 'stop', expect.stringMatching(/^sniptail-copilot-list-/) ],
      expect.any(Function),
    );
    expect(hoisted.execFile).toHaveBeenNthCalledWith(
      2,
      'docker',
      [ 'rm', '-f', expect.stringMatching(/^sniptail-copilot-list-/) ],
      expect.any(Function),
    );
  });

  it('wraps SDK failures and still stops the client', async () => {
    hoisted.listSessions.mockRejectedValue(new Error('list failed'));

    await expect(
      listCopilotSessions({
        workDir: '/tmp/repos',
        env: {},
        executionMode: 'local',
      }),
    ).rejects.toThrow('Copilot session list failed: list failed');

    expect(hoisted.stop).toHaveBeenCalledTimes(1);
  });

  it('forces cleanup when stop reports errors', async () => {
    hoisted.listSessions.mockResolvedValue([]);
    hoisted.stop.mockResolvedValue([new Error('stop failed')]);

    await listCopilotSessions({
      workDir: '/tmp/repos',
      env: {},
      executionMode: 'local',
    });

    expect(hoisted.forceStop).toHaveBeenCalledTimes(1);
  });

  it('cleans up docker mode when start fails after partial launch', async () => {
    hoisted.start.mockRejectedValue(new Error('start failed'));

    await expect(
      listCopilotSessions({
        workDir: '/tmp/repos',
        env: {},
        executionMode: 'docker',
        docker: {
          image: 'sniptail-copilot:local',
        },
      }),
    ).rejects.toThrow('Copilot session list failed: start failed');

    expect(hoisted.stop).toHaveBeenCalledTimes(1);
    expect(hoisted.forceStop).toHaveBeenCalledTimes(1);
    expect(hoisted.execFile).toHaveBeenNthCalledWith(
      1,
      'docker',
      ['stop', expect.stringMatching(/^sniptail-copilot-list-/)],
      expect.any(Function),
    );
    expect(hoisted.execFile).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['rm', '-f', expect.stringMatching(/^sniptail-copilot-list-/)],
      expect.any(Function),
    );
  });
});
