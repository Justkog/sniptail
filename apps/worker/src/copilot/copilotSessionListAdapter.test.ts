import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { ListedCopilotSession } from '@sniptail/core/copilot/copilotSessionListing.js';
import type { ResolvedAgentWorkspace } from '../agent-command/workspaceResolver.js';

const hoisted = vi.hoisted(() => ({
  listCopilotSessions: vi.fn<(input: unknown) => Promise<ListedCopilotSession[]>>(),
}));

vi.mock('@sniptail/core/copilot/copilotSessionListing.js', () => ({
  listCopilotSessions: hoisted.listCopilotSessions,
}));

import { copilotAgentSessionListAdapter } from './copilotSessionListAdapter.js';

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

function encodeCursor(
  offset: number,
  scope: {
    workerId?: string;
    agentProfileKey?: string;
    pageSize?: number;
    filters?: {
      workspaceKey?: string;
      cwd?: string;
      gitRoot?: string;
      repository?: string;
      branch?: string;
    };
  } = {},
): string {
  return `sniptail-copilot-sessions-v1.${Buffer.from(
    JSON.stringify({
      version: 1,
      mode: 'copilot',
      offset,
      scope: {
        workerId: scope.workerId ?? 'worker-a',
        agentProfileKey: scope.agentProfileKey ?? 'build',
        pageSize: scope.pageSize ?? 1,
        ...(scope.filters ? { filters: scope.filters } : {}),
      },
    }),
    'utf8',
  ).toString('base64url')}`;
}

describe('copilotSessionListAdapter', () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0, cleanupPaths.length)
        .map((pathValue) => rm(pathValue, { recursive: true, force: true })),
    );
  });

  async function createWorkspace(): Promise<ResolvedAgentWorkspace> {
    const workspaceRoot = await mkdtemp(join(os.tmpdir(), 'sniptail-copilot-list-'));
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

  it('lists Copilot sessions, normalizes summaries, slices to pageSize, and emits cursors', async () => {
    const resolvedWorkspace = await createWorkspace();
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-2',
        startTime: new Date('2026-05-22T09:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T09:00:00.000Z'),
        summary: 'Earlier session',
        isRemote: false,
        context: {
          cwd: join(resolvedWorkspace.workspaceRoot, 'packages', 'core'),
          repository: 'sniptail/snatch',
          branch: 'main',
        },
      },
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T11:00:00.000Z'),
        summary: 'Build session',
        isRemote: false,
        context: {
          cwd: resolvedWorkspace.resolvedCwd,
          repository: 'sniptail/snatch',
          branch: 'feature/browser',
        },
      },
      {
        sessionId: 'session-3',
        startTime: new Date('2026-05-22T08:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T08:30:00.000Z'),
        isRemote: false,
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'copilot',
        profile: 'build-agent',
      },
      pageSize: 2,
      filters: {
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
        gitRoot: ' /tmp/git-root ',
        repository: ' sniptail/snatch ',
        branch: ' feature/browser ',
        search: 'ignored',
      },
      resolvedWorkspace,
    });

    expect(hoisted.listCopilotSessions).toHaveBeenCalledWith({
      workDir: resolvedWorkspace.resolvedCwd,
      env: process.env,
      executionMode: 'local',
      filter: {
        cwd: resolvedWorkspace.resolvedCwd,
        gitRoot: '/tmp/git-root',
        repository: 'sniptail/snatch',
        branch: 'feature/browser',
      },
    });
    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'copilot',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'Build session',
          createdAt: '2026-05-22T10:00:00.000Z',
          updatedAt: '2026-05-22T11:00:00.000Z',
          project: 'sniptail/snatch',
          description: 'Branch: feature/browser',
        },
        {
          id: 'session-2',
          provider: 'copilot',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'packages/core',
          title: 'Earlier session',
          createdAt: '2026-05-22T09:00:00.000Z',
          updatedAt: '2026-05-22T09:00:00.000Z',
          project: 'sniptail/snatch',
          description: 'Branch: main',
        },
      ],
      nextCursor: encodeCursor(2, {
        pageSize: 2,
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          gitRoot: '/tmp/git-root',
          repository: 'sniptail/snatch',
          branch: 'feature/browser',
        },
      }),
      cursorState: {
        offset: 2,
      },
      hasMore: true,
    });
  });

  it('uses aggregate cursorState offset for later pages', async () => {
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        isRemote: false,
      },
      {
        sessionId: 'session-2',
        startTime: new Date('2026-05-22T09:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T09:00:00.000Z'),
        isRemote: false,
      },
      {
        sessionId: 'session-3',
        startTime: new Date('2026-05-22T08:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T08:00:00.000Z'),
        isRemote: false,
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'copilot',
      },
      pageSize: 1,
      cursorState: {
        offset: 1,
      },
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-2',
          provider: 'copilot',
          agentProfileKey: 'build',
          createdAt: '2026-05-22T09:00:00.000Z',
          updatedAt: '2026-05-22T09:00:00.000Z',
        },
      ],
      nextCursor: encodeCursor(2),
      cursorState: {
        offset: 2,
      },
      hasMore: true,
    });
  });

  it('accepts explicit synthetic cursor pagination', async () => {
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        isRemote: false,
      },
      {
        sessionId: 'session-2',
        startTime: new Date('2026-05-22T09:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T09:00:00.000Z'),
        isRemote: false,
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'copilot',
      },
      pageSize: 1,
      cursor: encodeCursor(1),
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-2',
          provider: 'copilot',
          agentProfileKey: 'build',
          createdAt: '2026-05-22T09:00:00.000Z',
          updatedAt: '2026-05-22T09:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('rejects malformed explicit Copilot cursors', async () => {
    hoisted.listCopilotSessions.mockResolvedValue([]);

    await expect(
      copilotAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'copilot',
        },
        pageSize: 1,
        cursor: 'bad-cursor',
      }),
    ).rejects.toThrow(
      'Copilot session list cursor is invalid or expired. Refresh the session list.',
    );
  });

  it('rejects explicit cursors reused with a different normalized filter scope', async () => {
    hoisted.listCopilotSessions.mockResolvedValue([]);

    await expect(
      copilotAgentSessionListAdapter.listSessions({
        config: buildConfig(),
        profile: {
          key: 'build',
          provider: 'copilot',
        },
        pageSize: 1,
        cursor: encodeCursor(1, {
          filters: {
            repository: 'sniptail/snatch',
            branch: 'main',
          },
        }),
        filters: {
          repository: 'sniptail/snatch',
          branch: 'feature/browser',
        },
      }),
    ).rejects.toThrow(
      'Copilot session list cursor is invalid or expired. Refresh the session list.',
    );
  });

  it('accepts explicit cursors when trimmed filters normalize to the same scope', async () => {
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        isRemote: false,
      },
      {
        sessionId: 'session-2',
        startTime: new Date('2026-05-22T09:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T09:00:00.000Z'),
        isRemote: false,
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfig(),
      profile: {
        key: 'build',
        provider: 'copilot',
      },
      pageSize: 1,
      cursor: encodeCursor(1, {
        filters: {
          repository: 'sniptail/snatch',
          branch: 'main',
        },
      }),
      filters: {
        repository: ' sniptail/snatch ',
        branch: ' main ',
      },
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-2',
          provider: 'copilot',
          agentProfileKey: 'build',
          createdAt: '2026-05-22T09:00:00.000Z',
          updatedAt: '2026-05-22T09:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('infers workspace metadata for unfiltered listings from configured workspaces', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-copilot-infer-workspace-');
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        isRemote: false,
        context: {
          cwd: join(workspaceRoot, 'apps', 'worker'),
        },
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        snatch: {
          path: workspaceRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'copilot',
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'copilot',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          createdAt: '2026-05-22T10:00:00.000Z',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });

  it('omits workspace metadata for ambiguous configured workspaces', async () => {
    const parentRoot = await createWorkspaceRoot('sniptail-copilot-overlap-parent-');
    const childRoot = join(parentRoot, 'apps');
    await mkdir(join(childRoot, 'worker'), { recursive: true });
    hoisted.listCopilotSessions.mockResolvedValue([
      {
        sessionId: 'session-1',
        startTime: new Date('2026-05-22T10:00:00.000Z'),
        modifiedTime: new Date('2026-05-22T10:00:00.000Z'),
        isRemote: false,
        context: {
          cwd: join(childRoot, 'worker'),
        },
      },
    ]);

    const result = await copilotAgentSessionListAdapter.listSessions({
      config: buildConfigWithWorkspaces({
        parent: {
          path: parentRoot,
        },
        child: {
          path: childRoot,
        },
      }),
      profile: {
        key: 'build',
        provider: 'copilot',
      },
      pageSize: 5,
    });

    expect(result).toEqual({
      sessions: [
        {
          id: 'session-1',
          provider: 'copilot',
          agentProfileKey: 'build',
          createdAt: '2026-05-22T10:00:00.000Z',
          updatedAt: '2026-05-22T10:00:00.000Z',
        },
      ],
      hasMore: false,
    });
  });
});
