import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  config: {
    queueDriver: 'inproc',
    redisUrl: undefined,
    botName: 'Sniptail',
    enabledChannels: [] as string[],
    slackEnabled: false,
    discordEnabled: false,
    telegramEnabled: false,
  },
  enqueueWorkerEvent: vi.fn(() => Promise.resolve(undefined)),
  createSlackApp: vi.fn(),
  startDiscordBot: vi.fn(),
  startTelegramBot: vi.fn(),
  startBotEventWorker: vi.fn(),
  loggerWarn: vi.fn<(context: { err: Error; provider: string }, message: string) => void>(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadBotConfig: () => hoisted.config,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  debugFor: vi.fn(() => vi.fn()),
  isDebugNamespaceEnabled: vi.fn(() => false),
  logger: {
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
    info: hoisted.loggerInfo,
  },
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('./slack/app.js', () => ({
  createSlackApp: hoisted.createSlackApp,
}));

vi.mock('./discord/app.js', () => ({
  startDiscordBot: hoisted.startDiscordBot,
}));

vi.mock('./telegram/app.js', () => ({
  startTelegramBot: hoisted.startTelegramBot,
}));

vi.mock('./botEventWorker.js', () => ({
  startBotEventWorker: hoisted.startBotEventWorker,
}));

import { startBotRuntime } from './botRuntimeLauncher.js';

describe('botRuntimeLauncher agent metadata requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.config.enabledChannels = [];
    hoisted.config.slackEnabled = false;
    hoisted.config.discordEnabled = false;
    hoisted.config.telegramEnabled = false;
    hoisted.createSlackApp.mockReturnValue({
      start: vi.fn(() => Promise.resolve(undefined)),
      stop: vi.fn(() => Promise.resolve(undefined)),
      client: {
        auth: {
          test: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    });
    hoisted.startDiscordBot.mockResolvedValue({
      destroy: vi.fn(() => Promise.resolve(undefined)),
    });
    hoisted.startTelegramBot.mockResolvedValue({
      stop: vi.fn(() => Promise.resolve(undefined)),
    });
    hoisted.startBotEventWorker.mockReturnValue({
      close: vi.fn(() => Promise.resolve(undefined)),
    });
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('enqueues a Slack metadata request when Slack starts', async () => {
    hoisted.config.enabledChannels = ['slack'];
    hoisted.config.slackEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queueRuntime.queues.workerEvents,
      expect.objectContaining({
        type: 'agent.metadata.request',
        payload: { provider: 'slack' },
      }),
    );
  });

  it('enqueues a Discord metadata request when Discord starts', async () => {
    hoisted.config.enabledChannels = ['discord'];
    hoisted.config.discordEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queueRuntime.queues.workerEvents,
      expect.objectContaining({
        type: 'agent.metadata.request',
        payload: { provider: 'discord' },
      }),
    );
  });

  it('enqueues both Slack and Discord metadata requests when both runtimes start', async () => {
    hoisted.config.enabledChannels = ['slack', 'discord'];
    hoisted.config.slackEnabled = true;
    hoisted.config.discordEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledTimes(2);
    expect(hoisted.enqueueWorkerEvent).toHaveBeenNthCalledWith(
      1,
      queueRuntime.queues.workerEvents,
      expect.objectContaining({
        type: 'agent.metadata.request',
        payload: { provider: 'slack' },
      }),
    );
    expect(hoisted.enqueueWorkerEvent).toHaveBeenNthCalledWith(
      2,
      queueRuntime.queues.workerEvents,
      expect.objectContaining({
        type: 'agent.metadata.request',
        payload: { provider: 'discord' },
      }),
    );
  });

  it('logs metadata request enqueue failures without aborting startup', async () => {
    hoisted.config.enabledChannels = ['slack'];
    hoisted.config.slackEnabled = true;
    hoisted.enqueueWorkerEvent.mockRejectedValueOnce(new Error('queue down'));
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    const [warningContext, warningMessage] = hoisted.loggerWarn.mock.calls[0] ?? [];
    expect(warningMessage).toBe('Failed to enqueue initial agent metadata request');
    expect(warningContext?.provider).toBe('slack');
    expect(warningContext?.err).toBeInstanceOf(Error);
    expect(hoisted.startBotEventWorker).toHaveBeenCalledTimes(1);
  });
});

function buildQueueRuntime() {
  return {
    driver: 'inproc',
    queues: {
      jobs: {},
      bootstrap: {},
      workerEvents: {},
    },
    close: vi.fn(() => Promise.resolve(undefined)),
  };
}
