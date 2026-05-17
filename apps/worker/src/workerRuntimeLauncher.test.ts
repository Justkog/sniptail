import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  config: {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'inproc',
    registryDriver: 'sqlite',
    registryPath: '/tmp/registry',
    botName: 'Sniptail',
    primaryAgent: 'codex',
    workerId: '',
    jobConcurrency: 2,
    bootstrapConcurrency: 2,
    consumeSharedWorkerEvents: true,
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
      enabled: false,
      interactionTimeoutMs: 300_000,
      outputDebounceMs: 1_000,
      workspaces: {},
      profiles: {},
    },
  },
  seedRepoCatalogFromAllowlistFile: vi.fn(),
  syncRunActionMetadata: vi.fn(),
  assertLocalAgentPreflight: vi.fn(() => Promise.resolve(undefined)),
  loadActiveSessionCountsByWorkerIds: vi.fn(),
  startWorkerCapabilityPublisher: vi.fn(() =>
    Promise.resolve({
      close: vi.fn(() => Promise.resolve(undefined)),
    }),
  ),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadWorkerConfig: () => hoisted.config,
}));

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  seedRepoCatalogFromAllowlistFile: hoisted.seedRepoCatalogFromAllowlistFile,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@sniptail/core/queue/queueTransportFactory.js', () => ({
  createQueueTransportRuntime: vi.fn(),
}));

vi.mock('./repos/syncRunActionMetadata.js', () => ({
  syncRunActionMetadata: hoisted.syncRunActionMetadata,
}));

vi.mock('./bootstrap.js', () => ({
  runBootstrap: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./pipeline.js', () => ({
  runJob: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./workerEvents.js', () => ({
  handleWorkerEvent: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@sniptail/core/registry/registryStoreFactory.js', () => ({
  createAgentSessionOwnershipRegistryStore: vi.fn(() =>
    Promise.resolve({
      listActiveSessionCountsByWorkerIds: hoisted.loadActiveSessionCountsByWorkerIds,
    }),
  ),
}));

vi.mock('./channels/botEventSink.js', () => ({
  BullMqBotEventSink: class {
    constructor(private readonly queue: { add: (...args: unknown[]) => Promise<unknown> }) {}

    async publish(event: { type: string }): Promise<void> {
      await this.queue.add(event.type, event, {});
    }
  },
}));

vi.mock('./docker/dockerPreflight.js', () => ({
  assertDockerPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./preflight/agentPreflight.js', () => ({
  assertLocalAgentPreflight: hoisted.assertLocalAgentPreflight,
}));

vi.mock('./agent-command/workerCapabilityPublisher.js', () => ({
  startWorkerCapabilityPublisher: hoisted.startWorkerCapabilityPublisher,
}));

vi.mock('./git/gitPreflight.js', () => ({
  assertGitCommitIdentityPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./job/createJobRegistry.js', () => ({
  createJobRegistry: vi.fn(() => ({
    loadJobRecord: vi.fn(),
    updateJobRecord: vi.fn(),
    loadAllJobRecords: vi.fn(),
    deleteJobRecords: vi.fn(),
    markJobForDeletion: vi.fn(),
    clearJobsBefore: vi.fn(),
    findLatestJobByChannelThread: vi.fn(),
    findLatestJobByChannelThreadAndTypes: vi.fn(),
  })),
}));

import { startWorkerRuntime } from './workerRuntimeLauncher.js';

function createConsumerHandle(
  overrides: Partial<{
    close: () => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
  }> = {},
) {
  return {
    close: overrides.close ?? vi.fn(() => Promise.resolve(undefined)),
    pause: overrides.pause ?? vi.fn(() => Promise.resolve(undefined)),
    resume: overrides.resume ?? vi.fn(() => Promise.resolve(undefined)),
  };
}

function createQueueRuntimeStub() {
  const jobsConsumer = createConsumerHandle();
  const bootstrapConsumer = createConsumerHandle();
  const workerEventsConsumer = createConsumerHandle();
  const mailboxConsumer = createConsumerHandle();
  const mailboxObserver = createConsumerHandle();
  const countWorkerMailboxJobs = vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 }));
  return {
    jobsConsumer,
    bootstrapConsumer,
    workerEventsConsumer,
    mailboxConsumer,
    mailboxObserver,
    countWorkerMailboxJobs,
    queueRuntime: {
      consumeJobs: vi.fn(() => jobsConsumer),
      consumeBootstrap: vi.fn(() => bootstrapConsumer),
      consumeWorkerEvents: vi.fn(() => workerEventsConsumer),
      consumeWorkerMailbox: vi.fn(() => mailboxConsumer),
      observeWorkerMailbox: vi.fn(() => mailboxObserver),
      countWorkerMailboxJobs,
      close: vi.fn(() => Promise.resolve(undefined)),
      queues: {
        botEvents: {
          add: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    },
  };
}

describe('workerRuntimeLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.seedRepoCatalogFromAllowlistFile.mockResolvedValue({ seeded: 0, skipped: true });
    hoisted.syncRunActionMetadata.mockResolvedValue({
      scanned: 0,
      updated: 0,
      failures: [],
    });
    hoisted.assertLocalAgentPreflight.mockResolvedValue(undefined);
    hoisted.loadActiveSessionCountsByWorkerIds.mockResolvedValue({});
    hoisted.startWorkerCapabilityPublisher.mockResolvedValue({
      close: vi.fn(() => Promise.resolve(undefined)),
    });
    hoisted.config.primaryAgent = 'codex';
    hoisted.config.workerEventConcurrency = 2;
    hoisted.config.consumeSharedWorkerEvents = true;
    hoisted.config.agent.enabled = false;
  });

  it('fails fast when queue_driver=inproc without a shared runtime', async () => {
    await expect(startWorkerRuntime()).rejects.toThrow('sniptail local');
    expect(hoisted.assertLocalAgentPreflight).not.toHaveBeenCalled();
  });

  it('syncs run action metadata after repository seed on startup', async () => {
    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledWith(hoisted.config, 'codex');
    expect(hoisted.seedRepoCatalogFromAllowlistFile).toHaveBeenCalledTimes(1);
    expect(hoisted.syncRunActionMetadata).toHaveBeenCalledTimes(1);
  });

  it('preflights only the configured primary agent', async () => {
    hoisted.config.primaryAgent = 'copilot';
    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalAgentPreflight).toHaveBeenCalledWith(hoisted.config, 'copilot');
  });

  it('starts and closes the worker capability publisher', async () => {
    hoisted.config.agent.enabled = true;
    const publisherClose = vi.fn(() => Promise.resolve(undefined));
    hoisted.startWorkerCapabilityPublisher.mockResolvedValue({ close: publisherClose });
    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.startWorkerCapabilityPublisher).toHaveBeenCalledWith(hoisted.config);
    expect(queueRuntime.consumeWorkerMailbox).not.toHaveBeenCalled();
    expect(publisherClose).toHaveBeenCalledTimes(1);
  });

  it('starts a mailbox consumer when agent mode exposes workspaces and profiles', async () => {
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(queueRuntime.consumeWorkerMailbox).toHaveBeenCalledWith(
      'worker-a',
      expect.objectContaining({ concurrency: 1 }),
    );
    expect(queueRuntime.consumeWorkerEvents).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it('preserves configured shared worker-event concurrency when mailbox mode is disabled', async () => {
    hoisted.config.workerEventConcurrency = 4;
    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(queueRuntime.consumeWorkerMailbox).not.toHaveBeenCalled();
    expect(queueRuntime.consumeWorkerEvents).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 4 }),
    );
    expect(queueRuntime.observeWorkerMailbox).not.toHaveBeenCalled();
  });

  it('skips shared worker-event consumption when disabled in worker config', async () => {
    hoisted.config.consumeSharedWorkerEvents = false;
    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(queueRuntime.consumeWorkerEvents).not.toHaveBeenCalled();
    expect(queueRuntime.consumeWorkerMailbox).not.toHaveBeenCalled();
  });

  it('still starts mailbox consumption when shared worker events are disabled', async () => {
    hoisted.config.consumeSharedWorkerEvents = false;
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(queueRuntime.consumeWorkerMailbox).toHaveBeenCalledWith(
      'worker-a',
      expect.objectContaining({ concurrency: 1 }),
    );
    expect(queueRuntime.observeWorkerMailbox).toHaveBeenCalledTimes(1);
    expect(queueRuntime.consumeWorkerEvents).not.toHaveBeenCalled();
  });

  it('starts the mailbox consumer before the shared worker-event consumer', async () => {
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    const calls: string[] = [];
    const consumerClose = vi.fn(() => Promise.resolve(undefined));
    const queueRuntime = {
      consumeJobs: vi.fn(() => ({ close: consumerClose })),
      consumeBootstrap: vi.fn(() => ({ close: consumerClose })),
      consumeWorkerEvents: vi.fn(() => {
        calls.push('shared');
        return createConsumerHandle({ close: consumerClose });
      }),
      consumeWorkerMailbox: vi.fn(() => {
        calls.push('mailbox');
        return createConsumerHandle({ close: consumerClose });
      }),
      observeWorkerMailbox: vi.fn(() => createConsumerHandle({ close: consumerClose })),
      countWorkerMailboxJobs: vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 })),
      close: vi.fn(() => Promise.resolve(undefined)),
      queues: {
        botEvents: {
          add: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    } as const;

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(calls).toEqual(['mailbox', 'shared']);
  });

  it('logs mailbox diagnostics with the queue name and active session count', async () => {
    const { logger } = await import('@sniptail/core/logger.js');
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };
    hoisted.loadActiveSessionCountsByWorkerIds.mockResolvedValue({ 'worker-a': 3 });

    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'worker-a',
        mailboxQueueName: 'sniptail-worker-mailbox:worker-a',
        consumeSharedWorkerEvents: true,
        configuredWorkerEventConcurrency: 2,
        effectiveWorkerEventConcurrency: 1,
        activeSessionCount: 3,
      }),
      'Worker mailbox mode enabled',
    );
  });

  it('warns and continues startup when mailbox diagnostics fail', async () => {
    const { logger } = await import('@sniptail/core/logger.js');
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };
    hoisted.loadActiveSessionCountsByWorkerIds.mockRejectedValue(new Error('registry down'));

    const { queueRuntime } = createQueueRuntimeStub();

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(queueRuntime.consumeWorkerMailbox).toHaveBeenCalledTimes(1);
    expect(queueRuntime.consumeWorkerEvents).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: 'worker-a',
        mailboxQueueName: 'sniptail-worker-mailbox:worker-a',
        consumeSharedWorkerEvents: true,
        configuredWorkerEventConcurrency: 2,
        effectiveWorkerEventConcurrency: 1,
      }),
      'Failed to load worker mailbox diagnostics',
    );
  });

  it('serializes mailbox and shared worker events through the same lane', async () => {
    const { handleWorkerEvent } = await import('./workerEvents.js');
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    let releaseShared!: () => void;
    const sharedStarted = new Promise<void>((resolve) => {
      releaseShared = resolve;
    });
    const mailboxStarted = vi.fn();
    const eventOrder: string[] = [];
    vi.mocked(handleWorkerEvent).mockImplementation(async (event) => {
      eventOrder.push(event.type);
      if (event.type === 'repos.add') {
        await sharedStarted;
        return;
      }
      mailboxStarted();
    });

    const consumerClose = vi.fn(() => Promise.resolve(undefined));
    let workerEventHandler!: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    let mailboxHandler!: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    const queueRuntime = {
      consumeJobs: vi.fn(() => createConsumerHandle({ close: consumerClose })),
      consumeBootstrap: vi.fn(() => createConsumerHandle({ close: consumerClose })),
      consumeWorkerEvents: vi.fn((options: { handler: typeof workerEventHandler }) => {
        workerEventHandler = options.handler;
        return createConsumerHandle({ close: consumerClose });
      }),
      consumeWorkerMailbox: vi.fn((_: string, options: { handler: typeof mailboxHandler }) => {
        mailboxHandler = options.handler;
        return createConsumerHandle({ close: consumerClose });
      }),
      observeWorkerMailbox: vi.fn(() => createConsumerHandle({ close: consumerClose })),
      countWorkerMailboxJobs: vi.fn(() => Promise.resolve({ waiting: 0, prioritized: 0 })),
      close: vi.fn(() => Promise.resolve(undefined)),
      queues: {
        botEvents: {
          add: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    } as const;

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });
    const sharedPromise = workerEventHandler({
      data: { requestId: '1', type: 'repos.add' },
    });
    await Promise.resolve();
    const mailboxPromise = mailboxHandler({
      data: { requestId: '2', type: 'agent.prompt.stop' },
    });
    await Promise.resolve();

    expect(mailboxStarted).not.toHaveBeenCalled();

    releaseShared();
    await Promise.all([sharedPromise, mailboxPromise]);
    await runtime.close();

    expect(eventOrder).toEqual(['repos.add', 'agent.prompt.stop']);
  });

  it('pauses shared worker events when mailbox activity is observed and resumes after mailbox drains', async () => {
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    const sharedWorkerEventsConsumer = createConsumerHandle();
    let mailboxHandler!: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    let onJobAvailable!: () => Promise<void>;
    const countWorkerMailboxJobs = vi
      .fn<() => Promise<{ waiting: number; prioritized: number }>>()
      .mockResolvedValueOnce({ waiting: 0, prioritized: 0 })
      .mockResolvedValueOnce({ waiting: 0, prioritized: 0 });
    const queueRuntime = {
      ...createQueueRuntimeStub().queueRuntime,
      consumeWorkerEvents: vi.fn(() => sharedWorkerEventsConsumer),
      consumeWorkerMailbox: vi.fn((_: string, options: { handler: typeof mailboxHandler }) => {
        mailboxHandler = options.handler;
        return createConsumerHandle();
      }),
      observeWorkerMailbox: vi.fn(
        (_: string, options: { onJobAvailable: typeof onJobAvailable }) => {
          onJobAvailable = options.onJobAvailable;
          return createConsumerHandle();
        },
      ),
      countWorkerMailboxJobs,
    };

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });

    expect(sharedWorkerEventsConsumer.pause).not.toHaveBeenCalled();

    await onJobAvailable();
    expect(sharedWorkerEventsConsumer.pause).toHaveBeenCalledTimes(1);

    await mailboxHandler({
      data: { requestId: 'mail-1', type: 'agent.prompt.stop' },
    });

    const mailboxOptions = queueRuntime.consumeWorkerMailbox.mock.calls[0]?.[1] as unknown as {
      onCompleted: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    };
    await mailboxOptions.onCompleted({
      data: { requestId: 'mail-1', type: 'agent.prompt.stop' },
    });

    expect(sharedWorkerEventsConsumer.resume).toHaveBeenCalledTimes(1);

    await runtime.close();
  });

  it('treats mailbox pause and resume as no-ops when shared worker events are disabled', async () => {
    hoisted.config.consumeSharedWorkerEvents = false;
    hoisted.config.agent.enabled = true;
    hoisted.config.workerId = 'worker-a';
    hoisted.config.agent.workspaces = {
      snatch: { path: '/tmp/snatch' },
    };
    hoisted.config.agent.profiles = {
      build: { provider: 'codex' },
    };

    let mailboxHandler!: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    let onJobAvailable!: () => Promise<void>;
    const queueRuntime = {
      ...createQueueRuntimeStub().queueRuntime,
      consumeWorkerMailbox: vi.fn((_: string, options: { handler: typeof mailboxHandler }) => {
        mailboxHandler = options.handler;
        return createConsumerHandle();
      }),
      observeWorkerMailbox: vi.fn(
        (_: string, options: { onJobAvailable: typeof onJobAvailable }) => {
          onJobAvailable = options.onJobAvailable;
          return createConsumerHandle();
        },
      ),
    };

    const runtime = await startWorkerRuntime({ queueRuntime: queueRuntime as never });

    await expect(onJobAvailable()).resolves.toBeUndefined();
    await expect(
      mailboxHandler({
        data: { requestId: 'mail-1', type: 'agent.prompt.stop' },
      }),
    ).resolves.toBeUndefined();

    const mailboxOptions = queueRuntime.consumeWorkerMailbox.mock.calls[0]?.[1] as unknown as {
      onCompleted: (job: { data: { requestId: string; type: string } }) => Promise<void>;
    };
    await expect(
      mailboxOptions.onCompleted({
        data: { requestId: 'mail-1', type: 'agent.prompt.stop' },
      }),
    ).resolves.toBeUndefined();

    await runtime.close();
  });
});
