import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentSessionListAdapter,
  AgentSessionListAdapterRegistry,
  AgentSessionListAdapterPageState,
  AgentSessionListAdapterResult,
} from './agentSessionListAdapters.js';
import { listAgentSessionsForWorker } from './agentSessionListService.js';

function createWorkerConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workerId: 'worker-a',
    workerLabel: 'Worker A',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'inproc',
    registryDriver: 'sqlite',
    registryPath: '/tmp/registry',
    registryNamespace: 'local',
    botName: 'Sniptail',
    primaryAgent: 'codex',
    jobConcurrency: 1,
    consumeSharedWorkerEvents: true,
    workerEventConcurrency: 1,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 1,
      idleTimeoutMs: 60_000,
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
    ...overrides,
  } as never;
}

function decodeAggregateCursor(cursor: string) {
  const prefix = 'sniptail-agent-sessions-v1.';
  if (!cursor.startsWith(prefix)) {
    throw new Error('bad cursor');
  }
  const parsed: unknown = JSON.parse(
    Buffer.from(cursor.slice(prefix.length), 'base64url').toString('utf8'),
  );
  return parsed;
}

function createListSessionsResult(
  result: AgentSessionListAdapterResult,
): AgentSessionListAdapterResult {
  return result;
}

describe('agentSessionListService', () => {
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

  async function createWorkspaceRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(os.tmpdir(), prefix));
    cleanupPaths.push(root);
    return root;
  }

  function createAdapter(
    provider: 'acp' | 'opencode' | 'copilot',
    impl?: Partial<AgentSessionListAdapter>,
  ): AgentSessionListAdapter {
    return {
      provider,
      listSessions: vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
        Promise.resolve(createListSessionsResult({ sessions: [] })),
      ),
      ...impl,
    };
  }

  it('dispatches explicit profile requests to the selected adapter and preserves raw cursor behavior', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-session-list-explicit-');
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve({
        sessions: [
          {
            id: 'provider-session-1',
            provider: 'acp',
            agentProfileKey: 'ignored',
            title: 'ACP session',
          },
        ],
        previousCursor: 'prev-1',
        nextCursor: 'next-1',
      } satisfies AgentSessionListAdapterResult),
    );
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: workspaceRoot,
          },
        },
        profiles: {
          build: {
            provider: 'acp',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'build',
        pageSize: 5,
        cursor: 'cursor-1',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    const acpListSessionsCall = acpListSessions.mock.calls[0];
    expect(acpListSessionsCall).toBeDefined();
    expect(acpListSessionsCall?.[0]).toMatchObject({
      pageSize: 5,
      cursor: 'cursor-1',
      filters: {
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
      },
      resolvedWorkspace: {
        workspaceKey: 'snatch',
        relativeCwd: join('apps', 'worker'),
      },
      profile: {
        key: 'build',
        provider: 'acp',
      },
    });
    expect(result).toEqual({
      sessions: [
        {
          id: 'provider-session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          title: 'ACP session',
        },
      ],
      previousCursor: 'prev-1',
      nextCursor: 'next-1',
    });
  });

  it('passes aggregate-looking cursors through explicit profile requests', async () => {
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(createListSessionsResult({ sessions: [] })),
    );
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const directCursor = `sniptail-agent-sessions-v1.${Buffer.from(
      JSON.stringify({
        version: 1,
        mode: 'aggregate',
        scope: {
          workerId: 'worker-a',
          pageSize: 5,
          profileKeys: ['build'],
        },
        profileStates: {},
        bufferedSessions: [],
      }),
      'utf8',
    ).toString('base64url')}`;
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'acp',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'build',
        pageSize: 5,
        cursor: directCursor,
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    expect(acpListSessions.mock.calls[0]?.[0]).toMatchObject({
      cursor: directCursor,
    });
    expect(result.errorMessage).toBeUndefined();
  });

  it('returns an error for an unknown explicit profile', async () => {
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {},
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      adapters: {},
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'missing',
        pageSize: 4,
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'Unknown agent profile key: missing',
    });
  });

  it('returns the Codex unsupported message for explicit Codex profiles', async () => {
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'codex',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'build',
        pageSize: 5,
      },
      adapters: {},
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage:
        'Session listing is not supported for Codex profiles because the Codex SDK does not expose previous sessions.',
    });
  });

  it('returns an unsupported error for an explicit provider without an adapter', async () => {
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'opencode',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      adapters: {},
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'build',
        pageSize: 5,
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'Session listing is not supported for provider "opencode" on profile "build".',
    });
  });

  it('aggregates across profiles, sorts deterministically, slices to page size, and emits an aggregate next cursor', async () => {
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(
        createListSessionsResult({
          sessions: [
            {
              id: 'acp-1',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T10:05:00.000Z',
            },
            {
              id: 'acp-2',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T09:59:00.000Z',
            },
          ],
        }),
      ),
    );
    const copilotListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(
      () =>
        Promise.resolve(
          createListSessionsResult({
            sessions: [
              {
                id: 'copilot-1',
                provider: 'copilot',
                agentProfileKey: 'ignored',
                updatedAt: '2026-05-22T10:10:00.000Z',
              },
            ],
            hasMore: true,
            cursorState: {
              offset: 1,
            },
          }),
        ),
    );
    const adapters: AgentSessionListAdapterRegistry = {
      acp: createAdapter('acp', {
        listSessions: acpListSessions,
      }),
      copilot: createAdapter('copilot', {
        listSessions: copilotListSessions,
      }),
    };
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          zed: {
            provider: 'copilot',
            profile: 'zed',
          },
          alpha: {
            provider: 'acp',
            profile: 'alpha',
          },
          codex: {
            provider: 'codex',
            profile: 'codex',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 2,
      },
      adapters,
    });

    expect(acpListSessions.mock.calls[0]?.[0]).toMatchObject({
      pageSize: 2,
    });
    expect(copilotListSessions.mock.calls[0]?.[0]).toMatchObject({
      pageSize: 2,
    });
    expect(result.previousCursor).toBeUndefined();
    expect(result.sessions).toEqual([
      {
        id: 'copilot-1',
        provider: 'copilot',
        agentProfileKey: 'zed',
        updatedAt: '2026-05-22T10:10:00.000Z',
      },
      {
        id: 'acp-1',
        provider: 'acp',
        agentProfileKey: 'alpha',
        updatedAt: '2026-05-22T10:05:00.000Z',
      },
    ]);
    expect(result.nextCursor).toBeDefined();

    const decoded = decodeAggregateCursor(result.nextCursor as string) as {
      initialPage?: true;
      previousCursor: string;
      profileStates: Record<string, AgentSessionListAdapterPageState>;
      bufferedSessions: Array<{ id: string }>;
    };
    expect(decoded.previousCursor).toMatch(/^sniptail-agent-sessions-v1\./);
    const previousDecoded = decodeAggregateCursor(decoded.previousCursor) as {
      initialPage?: true;
      profileStates: Record<string, AgentSessionListAdapterPageState>;
      bufferedSessions: Array<{ id: string }>;
    };
    expect(previousDecoded.initialPage).toBe(true);
    expect(previousDecoded.profileStates).toEqual({});
    expect(previousDecoded.bufferedSessions).toEqual([]);
    expect(decoded.profileStates).toEqual({
      zed: {
        offset: 1,
      },
    });
    expect(decoded.bufferedSessions).toEqual([
      {
        id: 'acp-2',
        provider: 'acp',
        agentProfileKey: 'alpha',
        updatedAt: '2026-05-22T09:59:00.000Z',
      },
    ]);
  });

  it('replays buffered sessions on the next aggregate page without re-querying completed profiles', async () => {
    const copilotListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(
      () => Promise.resolve(createListSessionsResult({ sessions: [] })),
    );
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(
        createListSessionsResult({
          sessions: [
            {
              id: 'acp-1',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T10:05:00.000Z',
            },
            {
              id: 'acp-2',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T09:59:00.000Z',
            },
          ],
        }),
      ),
    );
    const copilotAdapter = createAdapter('copilot', {
      listSessions: copilotListSessions,
    });
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          zed: {
            provider: 'copilot',
            profile: 'zed',
          },
          alpha: {
            provider: 'acp',
            profile: 'alpha',
          },
        },
      },
    });

    const firstPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
      },
      adapters: {
        acp: acpAdapter,
        copilot: copilotAdapter,
      },
    });

    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        cursor: firstPage.nextCursor,
      },
      adapters: {
        acp: acpAdapter,
        copilot: copilotAdapter,
      },
    });

    expect(secondPage.sessions).toEqual([
      {
        id: 'acp-2',
        provider: 'acp',
        agentProfileKey: 'alpha',
        updatedAt: '2026-05-22T09:59:00.000Z',
      },
    ]);
    expect(secondPage.previousCursor).toMatch(/^sniptail-agent-sessions-v1\./);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(acpListSessions).toHaveBeenCalledTimes(1);
    expect(copilotListSessions).toHaveBeenCalledTimes(1);

    const previousPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        cursor: secondPage.previousCursor,
      },
      adapters: {
        acp: acpAdapter,
        copilot: copilotAdapter,
      },
    });

    expect(previousPage.sessions).toEqual([
      {
        id: 'acp-1',
        provider: 'acp',
        agentProfileKey: 'alpha',
        updatedAt: '2026-05-22T10:05:00.000Z',
      },
    ]);
    expect(previousPage.previousCursor).toBeUndefined();
    expect(previousPage.nextCursor).toBeDefined();
    expect(acpListSessions).toHaveBeenCalledTimes(2);
    expect(copilotListSessions).toHaveBeenCalledTimes(2);
  });

  it('queries only profiles with saved cursor state when buffered sessions do not fill the page', async () => {
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(
        createListSessionsResult({
          sessions: [
            {
              id: 'acp-buffered',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T10:00:00.000Z',
            },
          ],
        }),
      ),
    );
    const copilotListSessions = vi
      .fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>()
      .mockResolvedValueOnce({
        sessions: [],
        hasMore: true,
        cursorState: {
          cursor: 'copilot-next',
          offset: 2,
        },
      })
      .mockResolvedValueOnce(
        createListSessionsResult({
          sessions: [
            {
              id: 'copilot-next-session',
              provider: 'copilot',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T09:59:00.000Z',
            },
          ],
        }),
      );
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const copilotAdapter = createAdapter('copilot', {
      listSessions: copilotListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          zed: {
            provider: 'copilot',
            profile: 'zed',
          },
          alpha: {
            provider: 'acp',
            profile: 'alpha',
          },
        },
      },
    });

    const firstPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
      },
      adapters: {
        acp: acpAdapter,
        copilot: copilotAdapter,
      },
    });

    await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        cursor: firstPage.nextCursor,
      },
      adapters: {
        acp: acpAdapter,
        copilot: copilotAdapter,
      },
    });

    expect(copilotListSessions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursorState: {
          cursor: 'copilot-next',
          offset: 2,
        },
      }),
    );
    expect(acpListSessions).toHaveBeenCalledTimes(1);
  });

  it('matches aggregate cursor scope for equivalent normalized cwd filters', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-session-list-normalized-cwd-');
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(
        createListSessionsResult({
          sessions: [
            {
              id: 'acp-1',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T10:00:00.000Z',
            },
            {
              id: 'acp-2',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T09:59:00.000Z',
            },
          ],
        }),
      ),
    );
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: workspaceRoot,
          },
        },
        profiles: {
          build: {
            provider: 'acp',
            profile: 'build',
          },
        },
      },
    });

    const firstPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        filters: {
          workspaceKey: 'snatch',
          cwd: './apps//worker/.',
        },
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    const secondPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        cursor: firstPage.nextCursor,
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    expect(secondPage.errorMessage).toBeUndefined();
    expect(secondPage.sessions).toEqual([
      {
        id: 'acp-2',
        provider: 'acp',
        agentProfileKey: 'build',
        updatedAt: '2026-05-22T09:59:00.000Z',
      },
    ]);
  });

  it('matches aggregate cursor scope for reordered duplicate roots filters', async () => {
    const acpListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(() =>
      Promise.resolve(
        createListSessionsResult({
          sessions: [
            {
              id: 'acp-1',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T10:00:00.000Z',
            },
            {
              id: 'acp-2',
              provider: 'acp',
              agentProfileKey: 'ignored',
              updatedAt: '2026-05-22T09:59:00.000Z',
            },
          ],
        }),
      ),
    );
    const acpAdapter = createAdapter('acp', {
      listSessions: acpListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'acp',
            profile: 'build',
          },
        },
      },
    });

    const firstPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        filters: {
          roots: ['packages/core', ' apps/worker ', 'packages/core', ''],
        },
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    const secondPage = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 1,
        cursor: firstPage.nextCursor,
        filters: {
          roots: ['apps/worker', 'packages/core'],
        },
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    expect(secondPage.errorMessage).toBeUndefined();
    expect(secondPage.sessions.map((session) => session.id)).toEqual(['acp-2']);
  });

  it('returns a clear error when no configured profiles can list sessions', async () => {
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'codex',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 4,
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage:
        'Worker `worker-a` has no configured agent profiles that support session listing.',
    });
  });

  it('returns validation errors for cwd without a workspace key', async () => {
    const config = createWorkerConfig();

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        filters: {
          cwd: 'apps/worker',
        },
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'A workspace key is required when cwd is provided.',
    });
  });

  it('returns workspace validation errors for unknown workspace keys', async () => {
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {},
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        filters: {
          workspaceKey: 'missing',
        },
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'Unknown workspace key: missing',
    });
  });

  it('returns workspace validation errors for absolute cwd values', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-session-list-absolute-');
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: workspaceRoot,
          },
        },
        profiles: {},
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        filters: {
          workspaceKey: 'snatch',
          cwd: '/tmp',
        },
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage:
        'Invalid cwd for workspace "snatch". Expected a relative path, got absolute path.',
    });
  });

  it('returns workspace validation errors for escaping cwd values', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-session-list-escape-');
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {
          snatch: {
            path: workspaceRoot,
          },
        },
        profiles: {},
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        filters: {
          workspaceKey: 'snatch',
          cwd: '../outside',
        },
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'Resolved cwd escapes workspace "snatch".',
    });
  });

  it('returns invalid cursor errors for malformed or mismatched aggregate cursors', async () => {
    const acpAdapter = createAdapter('acp');
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'acp',
            profile: 'build',
          },
        },
      },
    });

    const malformed = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        cursor: 'sniptail-agent-sessions-v1.not-json',
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    const mismatched = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
        cursor: `sniptail-agent-sessions-v1.${Buffer.from(
          JSON.stringify({
            version: 1,
            mode: 'aggregate',
            previousCursor: 'sniptail-agent-sessions-v1.prev',
            scope: {
              workerId: 'worker-a',
              pageSize: 9,
              profileKeys: ['build'],
            },
            profileStates: {},
            bufferedSessions: [],
          }),
          'utf8',
        ).toString('base64url')}`,
      },
      adapters: {
        acp: acpAdapter,
      },
    });

    expect(malformed).toEqual({
      sessions: [],
      errorMessage: 'Session list cursor is invalid or expired. Refresh the session list.',
    });
    expect(mismatched).toEqual({
      sessions: [],
      errorMessage: 'Session list cursor is invalid or expired. Refresh the session list.',
    });
  });

  it('returns explicit profile adapter failures as user-facing errors', async () => {
    const opencodeListSessions = vi.fn<(input: unknown) => Promise<AgentSessionListAdapterResult>>(
      () => Promise.reject(new Error('endpoint unavailable')),
    );
    const opencodeAdapter = createAdapter('opencode', {
      listSessions: opencodeListSessions,
    });
    const config = createWorkerConfig({
      agent: {
        enabled: true,
        interactionTimeoutMs: 300_000,
        outputDebounceMs: 1_000,
        workspaces: {},
        profiles: {
          build: {
            provider: 'opencode',
            profile: 'build',
          },
        },
      },
    });

    const result = await listAgentSessionsForWorker({
      config,
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'build',
        pageSize: 4,
      },
      adapters: {
        opencode: opencodeAdapter,
      },
    });

    expect(result).toEqual({
      sessions: [],
      errorMessage: 'Failed to list sessions for profile "build": endpoint unavailable',
    });
  });
});
