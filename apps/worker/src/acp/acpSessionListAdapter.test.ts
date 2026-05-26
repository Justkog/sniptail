import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { ResolvedAgentWorkspace } from '../agent-command/workspaceResolver.js';

const hoisted = vi.hoisted(() => ({
  launchAcpRuntime: vi.fn(),
  listSessions: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock('@sniptail/core/acp/acpRuntime.js', () => ({
  launchAcpRuntime: hoisted.launchAcpRuntime,
}));

import { acpAgentSessionListAdapter } from './acpSessionListAdapter.js';

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

describe('acpSessionListAdapter', () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.launchAcpRuntime.mockResolvedValue({
      listSessions: hoisted.listSessions,
      close: hoisted.close,
    });
  });

  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0, cleanupPaths.length)
        .map((pathValue) => rm(pathValue, { recursive: true, force: true })),
    );
  });

  async function createWorkspace(): Promise<ResolvedAgentWorkspace> {
    const workspaceRoot = await mkdtemp(join(os.tmpdir(), 'sniptail-acp-list-'));
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

  it('launches ACP, maps validated filters, normalizes sessions, and preserves nextCursor', async () => {
    const resolvedWorkspace = await createWorkspace();
    hoisted.listSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          cwd: resolvedWorkspace.resolvedCwd,
          title: 'Build session',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
        {
          sessionId: 'session-2',
          cwd: join(resolvedWorkspace.workspaceRoot, 'packages', 'core'),
          title: null,
          updatedAt: null,
        },
      ],
      nextCursor: 'cursor-2',
    });

    const result = await acpAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'acp',
        agent: 'opencode',
        command: ['opencode', 'acp'],
      },
      pageSize: 5,
      filters: {
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
        roots: ['packages/core', ' packages/core ', ''],
      },
      resolvedWorkspace,
    });

    expect(hoisted.launchAcpRuntime).toHaveBeenCalledWith({
      launch: {
        key: 'build',
        provider: 'acp',
        agent: 'opencode',
        command: ['opencode', 'acp'],
      },
      cwd: resolvedWorkspace.resolvedCwd,
      diagnostics: {
        configSource: 'agent.profiles.build',
      },
    });
    expect(hoisted.listSessions).toHaveBeenCalledWith({
      cwd: resolvedWorkspace.resolvedCwd,
      additionalDirectories: [join(resolvedWorkspace.workspaceRoot, 'packages', 'core')],
    });
    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'Build session',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
        {
          id: 'session-2',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'packages/core',
        },
      ],
      nextCursor: 'cursor-2',
      cursorState: {
        cursor: 'cursor-2',
      },
      hasMore: true,
    });
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('infers workspaceKey and cwd for unfiltered ACP listings from configured workspaces', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-acp-infer-workspace-');
    hoisted.listSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          cwd: join(workspaceRoot, 'apps', 'worker'),
          title: 'Build session',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
      ],
    });

    const result = await acpAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'Build session',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('normalizes ACP additionalDirectories into workspace-relative roots', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-acp-roots-');
    hoisted.listSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          cwd: join(workspaceRoot, 'apps', 'worker'),
          additionalDirectories: [
            join(workspaceRoot, 'packages', 'core'),
            join(workspaceRoot, 'packages', 'core'),
            join(workspaceRoot, 'apps', 'worker'),
          ],
        },
      ],
    });

    const result = await acpAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          roots: ['packages/core', 'apps/worker'],
        },
      ],
      hasMore: false,
    });
  });

  it('omits workspace metadata and roots for ACP paths outside configured workspaces', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-acp-outside-');
    hoisted.listSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          cwd: '/tmp/outside/project',
          additionalDirectories: [join(workspaceRoot, 'packages', 'core')],
          title: 'Detached session',
        },
      ],
    });

    const result = await acpAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          title: 'Detached session',
        },
      ],
      hasMore: false,
    });
  });

  it('omits ambiguous workspace metadata when multiple workspaces match the ACP cwd', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-acp-ambiguous-');
    hoisted.listSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          cwd: join(workspaceRoot, 'apps', 'worker'),
        },
      ],
    });

    const result = await acpAgentSessionListAdapter.listSessions({
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
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'acp',
          agentProfileKey: 'build',
        },
      ],
      hasMore: false,
    });
  });

  it('uses aggregate cursorState.cursor without passing offset or pageSize to ACP', async () => {
    const resolvedWorkspace = await createWorkspace();
    hoisted.listSessions.mockResolvedValue({
      sessions: [],
    });

    const result = await acpAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      pageSize: 4,
      cursor: 'explicit-cursor',
      cursorState: {
        cursor: 'aggregate-cursor',
        offset: 10,
      },
      resolvedWorkspace,
    });

    expect(hoisted.listSessions).toHaveBeenCalledWith({
      cursor: 'aggregate-cursor',
      cwd: resolvedWorkspace.resolvedCwd,
    });
    expect(result).toEqual({
      sessions: [],
      hasMore: false,
    });
  });

  it('closes the ACP runtime when listing fails', async () => {
    const resolvedWorkspace = await createWorkspace();
    hoisted.listSessions.mockRejectedValue(new Error('List failed'));

    await expect(
      acpAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'acp',
          command: ['opencode', 'acp'],
        },
        pageSize: 5,
        resolvedWorkspace,
      }),
    ).rejects.toThrow('List failed');

    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('rejects roots filters without a resolved workspace before launching ACP', async () => {
    await expect(
      acpAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'acp',
          command: ['opencode', 'acp'],
        },
        pageSize: 5,
        filters: {
          roots: ['packages/core'],
        },
      }),
    ).rejects.toThrow(
      'A workspace key is required when roots are provided for ACP session listing.',
    );

    expect(hoisted.launchAcpRuntime).not.toHaveBeenCalled();
  });

  it('rejects roots that escape the selected workspace', async () => {
    const resolvedWorkspace = await createWorkspace();

    await expect(
      acpAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'acp',
          command: ['opencode', 'acp'],
        },
        pageSize: 5,
        filters: {
          roots: ['../outside'],
        },
        resolvedWorkspace,
      }),
    ).rejects.toThrow('Resolved roots filter escapes the selected workspace.');

    expect(hoisted.launchAcpRuntime).not.toHaveBeenCalled();
  });
});
