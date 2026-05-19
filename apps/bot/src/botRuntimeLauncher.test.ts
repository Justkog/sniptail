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

describe('botRuntimeLauncher', () => {
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
  });

  it('starts Slack without enqueueing metadata requests', async () => {
    hoisted.config.enabledChannels = ['slack'];
    hoisted.config.slackEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.startBotEventWorker).toHaveBeenCalledTimes(1);
  });

  it('starts Discord without enqueueing metadata requests', async () => {
    hoisted.config.enabledChannels = ['discord'];
    hoisted.config.discordEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

    expect(hoisted.startBotEventWorker).toHaveBeenCalledTimes(1);
  });

  it('starts both Slack and Discord without enqueueing metadata requests', async () => {
    hoisted.config.enabledChannels = ['slack', 'discord'];
    hoisted.config.slackEnabled = true;
    hoisted.config.discordEnabled = true;
    const queueRuntime = buildQueueRuntime();

    const runtime = await startBotRuntime({ queueRuntime: queueRuntime as never });
    await runtime.close();

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
