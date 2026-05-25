import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { ResolvedAgentWorkspace } from '../agent-command/workspaceResolver.js';

const hoisted = vi.hoisted(() => ({
  createLocalRuntime: vi.fn(),
  createServerRuntime: vi.fn(),
  createDockerRuntime: vi.fn(),
  sessionList: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock('@sniptail/core/opencode/runtime.js', () => ({
  createLocalRuntime: hoisted.createLocalRuntime,
  createServerRuntime: hoisted.createServerRuntime,
  createDockerRuntime: hoisted.createDockerRuntime,
}));

import { openCodeAgentSessionListAdapter } from './openCodeSessionListAdapter.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    registryDriver: 'redis',
    registryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    workerId: 'worker-a',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    jobConcurrency: 2,
    workerEventConcurrency: 2,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
      idleTimeoutMs: 300_000,
    },
    codex: {
      executionMode: 'local',
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    agent: {
      enabled: true,
      interactionTimeoutMs: 300_000,
      outputDebounceMs: 1_000,
      workspaces: {},
      profiles: {},
    },
  };
}

function buildConfigWithWorkspaces(workspaces: WorkerConfig['agent']['workspaces']): WorkerConfig {
  return {
    ...buildConfig(),
    agent: {
      enabled: true,
      interactionTimeoutMs: 300_000,
      outputDebounceMs: 1_000,
      workspaces,
      profiles: {},
    },
  };
}

describe('openCodeSessionListAdapter', () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    const runtime = {
      baseUrl: 'http://127.0.0.1:4096',
      client: {
        session: {
          list: hoisted.sessionList,
        },
      },
      close: hoisted.close,
    };
    hoisted.createLocalRuntime.mockResolvedValue(runtime);
    hoisted.createServerRuntime.mockReturnValue(runtime);
    hoisted.createDockerRuntime.mockResolvedValue(runtime);
  });

  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0, cleanupPaths.length)
        .map((pathValue) => rm(pathValue, { recursive: true, force: true })),
    );
  });

  async function createWorkspace(): Promise<ResolvedAgentWorkspace> {
    const workspaceRoot = await mkdtemp(join(os.tmpdir(), 'sniptail-opencode-list-'));
    cleanupPaths.push(workspaceRoot);
    await mkdir(join(workspaceRoot, 'apps', 'worker'), { recursive: true });
    await mkdir(join(workspaceRoot, 'packages', 'core'), { recursive: true });
    return {
      workspaceKey: 'snatch',
      workspaceRoot,
      resolvedCwd: join(workspaceRoot, 'apps', 'worker'),
      relativeCwd: 'apps/worker',
      display: {
        workspaceKey: 'snatch',
        name: 'snatch / apps/worker',
        cwd: 'apps/worker',
      },
    };
  }

  async function createWorkspaceRoot(prefix: string): Promise<string> {
    const workspaceRoot = await mkdtemp(join(os.tmpdir(), prefix));
    cleanupPaths.push(workspaceRoot);
    await mkdir(join(workspaceRoot, 'apps', 'worker'), { recursive: true });
    await mkdir(join(workspaceRoot, 'packages', 'core'), { recursive: true });
    return workspaceRoot;
  }

  it('lists OpenCode sessions, normalizes summaries, slices to pageSize, and emits nextCursor', async () => {
    const resolvedWorkspace = await createWorkspace();
    hoisted.sessionList.mockResolvedValue({
      data: [
        {
          id: 'session-2',
          directory: join(resolvedWorkspace.workspaceRoot, 'packages', 'core'),
          title: 'Earlier session',
          time: {
            created: 1716368400000,
            updated: 1716368400000,
          },
          project: {
            id: 'project-1',
            name: 'snatch',
            worktree: '/tmp/worktree',
          },
        },
        {
          id: 'session-1',
          directory: resolvedWorkspace.resolvedCwd,
          title: 'Build session',
          time: {
            created: 1716372000000,
            updated: 1716375600000,
          },
          project: {
            id: 'project-1',
            name: 'snatch',
            worktree: '/tmp/worktree',
          },
        },
        {
          id: 'session-3',
          directory: resolvedWorkspace.resolvedCwd,
          title: 'Overflow session',
          time: {
            created: 1716361200000,
            updated: 1716364800000,
          },
          project: null,
        },
      ],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
        profile: 'build-agent',
      },
      pageSize: 2,
      filters: {
        search: ' build ',
      },
      resolvedWorkspace,
    });

    expect(hoisted.createLocalRuntime).toHaveBeenCalledWith(resolvedWorkspace.resolvedCwd, {
      opencode: {
        executionMode: 'local',
        agent: 'build-agent',
        startupTimeoutMs: 10_000,
        dockerStreamLogs: false,
      },
    });
    expect(hoisted.sessionList).toHaveBeenCalledWith({
      directory: resolvedWorkspace.resolvedCwd,
      search: 'build',
      limit: 3,
    });
    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'opencode',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'Build session',
          createdAt: '2024-05-22T10:00:00.000Z',
          updatedAt: '2024-05-22T11:00:00.000Z',
          project: 'snatch',
        },
        {
          id: 'session-2',
          provider: 'opencode',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'packages/core',
          title: 'Earlier session',
          createdAt: '2024-05-22T09:00:00.000Z',
          updatedAt: '2024-05-22T09:00:00.000Z',
          project: 'snatch',
        },
      ],
      nextCursor: '1716368400000',
      cursorState: {
        cursor: '1716368400000',
      },
      hasMore: true,
    });
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('uses aggregate cursorState cursor instead of explicit cursor on later pages', async () => {
    hoisted.sessionList.mockResolvedValue({
      data: [],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 4,
      cursor: '1716300000000',
      cursorState: {
        cursor: '1716200000000',
      },
    });

    expect(hoisted.sessionList).toHaveBeenCalledWith({
      cursor: 1716200000000,
      limit: 5,
    });
    expect(result).toEqual({
      sessions: [],
      hasMore: false,
    });
  });

  it('passes an explicit next-page cursor through direct profile pagination', async () => {
    hoisted.sessionList.mockResolvedValue({
      data: [],
    });

    await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 4,
      cursor: '2024-05-22T09:00:00.000Z',
    });

    expect(hoisted.sessionList).toHaveBeenCalledWith({
      cursor: 1716368400000,
      limit: 5,
    });
  });

  it('passes a validated start filter to OpenCode', async () => {
    hoisted.sessionList.mockResolvedValue({
      data: [],
    });

    await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
      filters: {
        start: '2024-05-22T09:00:00.000Z',
      },
    });

    expect(hoisted.sessionList).toHaveBeenCalledWith({
      start: 1716368400000,
      limit: 6,
    });
  });

  it('rejects invalid start filters before calling OpenCode', async () => {
    await expect(
      openCodeAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'opencode',
        },
        pageSize: 5,
        filters: {
          start: 'not-a-timestamp',
        },
      }),
    ).rejects.toThrow(
      'Invalid start filter. Expected an ISO timestamp or milliseconds since epoch.',
    );

    expect(hoisted.sessionList).not.toHaveBeenCalled();
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('wraps OpenCode SDK error responses and closes the runtime', async () => {
    hoisted.sessionList.mockResolvedValue({
      error: {
        code: 'unauthorized',
      },
    });

    await expect(
      openCodeAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'opencode',
        },
        pageSize: 5,
      }),
    ).rejects.toThrow('OpenCode session list failed: {"code":"unauthorized"}');

    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('surfaces missing server configuration through the existing runtime path', async () => {
    const config = {
      ...buildConfig(),
      opencode: {
        executionMode: 'server' as const,
        startupTimeoutMs: 10_000,
        dockerStreamLogs: false,
      },
    };
    hoisted.createServerRuntime.mockImplementation(() => {
      throw new Error('[opencode].server_url is required when execution_mode="server".');
    });

    await expect(
      openCodeAgentSessionListAdapter.listSessions({
        config,
        profile: {
          key: 'build',
          provider: 'opencode',
        },
        pageSize: 5,
      }),
    ).rejects.toThrow('[opencode].server_url is required when execution_mode="server".');
  });

  it('uses server mode runtime config with auth header env when configured', async () => {
    const config = {
      ...buildConfig(),
      opencode: {
        executionMode: 'server' as const,
        serverUrl: 'http://opencode.example',
        serverAuthHeaderEnv: 'OPENCODE_AUTH_HEADER',
        startupTimeoutMs: 5_000,
        dockerStreamLogs: false,
      },
    };
    hoisted.sessionList.mockResolvedValue({
      data: [],
    });

    await openCodeAgentSessionListAdapter.listSessions({
      config,
      profile: {
        key: 'build',
        provider: 'opencode',
        profile: 'build-agent',
      },
      pageSize: 5,
    });

    expect(hoisted.createServerRuntime).toHaveBeenCalledWith('/tmp/repos', process.env, {
      opencode: {
        executionMode: 'server',
        serverUrl: 'http://opencode.example',
        serverAuthHeaderEnv: 'OPENCODE_AUTH_HEADER',
        agent: 'build-agent',
        startupTimeoutMs: 5_000,
        dockerStreamLogs: false,
      },
    });
  });

  it('uses docker mode runtime config and runtime id when configured', async () => {
    const config = {
      ...buildConfig(),
      opencode: {
        executionMode: 'docker' as const,
        startupTimeoutMs: 7_500,
        dockerStreamLogs: true,
        dockerfilePath: './Dockerfile.opencode',
        dockerImage: 'sniptail-opencode:local',
        dockerBuildContext: '.',
      },
    };
    hoisted.sessionList.mockResolvedValue({
      data: [],
    });

    await openCodeAgentSessionListAdapter.listSessions({
      config,
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
    });

    expect(hoisted.createDockerRuntime).toHaveBeenCalledWith(
      'agent-session-list-build',
      '/tmp/repos',
      process.env,
      {
        opencode: {
          executionMode: 'docker',
          startupTimeoutMs: 7_500,
          dockerStreamLogs: true,
          docker: {
            enabled: true,
            dockerfilePath: './Dockerfile.opencode',
            image: 'sniptail-opencode:local',
            buildContext: '.',
          },
        },
      },
    );
  });

  it('infers workspaceKey and cwd for unfiltered listings from configured workspaces', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-opencode-infer-workspace-');
    hoisted.sessionList.mockResolvedValue({
      data: [
        {
          id: 'session-1',
          directory: join(workspaceRoot, 'apps', 'worker'),
          title: 'Build session',
          time: {
            created: 1716372000000,
            updated: 1716375600000,
          },
          project: null,
        },
      ],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'opencode',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'Build session',
          createdAt: '2024-05-22T10:00:00.000Z',
          updatedAt: '2024-05-22T11:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('omits workspace metadata for paths outside configured workspaces', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-opencode-outside-');
    hoisted.sessionList.mockResolvedValue({
      data: [
        {
          id: 'session-1',
          directory: '/tmp/outside/project',
          title: 'Detached session',
          time: {
            created: 1716372000000,
            updated: 1716375600000,
          },
          project: null,
        },
      ],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'opencode',
          agentProfileKey: 'build',
          title: 'Detached session',
          createdAt: '2024-05-22T10:00:00.000Z',
          updatedAt: '2024-05-22T11:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('omits ambiguous workspace metadata when multiple workspaces match the session directory', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-opencode-ambiguous-');
    hoisted.sessionList.mockResolvedValue({
      data: [
        {
          id: 'session-1',
          directory: join(workspaceRoot, 'apps', 'worker'),
          title: 'Ambiguous session',
          time: {
            created: 1716372000000,
            updated: 1716375600000,
          },
          project: null,
        },
      ],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        root: {
          path: workspaceRoot,
        },
        nested: {
          path: join(workspaceRoot, 'apps'),
        },
      }),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'opencode',
          agentProfileKey: 'build',
          title: 'Ambiguous session',
          createdAt: '2024-05-22T10:00:00.000Z',
          updatedAt: '2024-05-22T11:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('sorts equal-timestamp sessions deterministically by id', async () => {
    hoisted.sessionList.mockResolvedValue({
      data: [
        {
          id: 'session-b',
          directory: '/tmp/repos',
          title: 'B',
          time: {
            created: 1716375600000,
            updated: 1716375600000,
          },
          project: null,
        },
        {
          id: 'session-a',
          directory: '/tmp/repos',
          title: 'A',
          time: {
            created: 1716375600000,
            updated: 1716375600000,
          },
          project: null,
        },
      ],
    });

    const result = await openCodeAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'opencode',
      },
      pageSize: 5,
    });

    expect(result.sessions.map((session) => session.id)).toEqual(['session-a', 'session-b']);
  });
});
