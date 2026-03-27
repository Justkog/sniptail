import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMention } from './mention.js';

const enqueueJobMock = vi.hoisted(() => vi.fn());
const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const refreshRepoAllowlistMock = vi.hoisted(() => vi.fn());
const authorizeDiscordOperationAndRespondMock = vi.hoisted(() => vi.fn());
const fetchDiscordThreadContextMock = vi.hoisted(() => vi.fn());
const dedupeMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('../../../lib/repoAllowlist.js', () => ({
  refreshRepoAllowlist: refreshRepoAllowlistMock,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: authorizeDiscordOperationAndRespondMock,
}));

vi.mock('../../threadContext.js', async () => {
  const actual = await vi.importActual<typeof import('../../threadContext.js')>(
    '../../threadContext.js',
  );
  return {
    ...actual,
    fetchDiscordThreadContext: fetchDiscordThreadContextMock,
  };
});

vi.mock('../../../slack/lib/dedupe.js', () => ({
  dedupe: dedupeMock,
}));

describe('Discord mention event flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueJobMock.mockResolvedValue(undefined);
    saveJobQueuedMock.mockResolvedValue(undefined);
    refreshRepoAllowlistMock.mockResolvedValue(undefined);
    authorizeDiscordOperationAndRespondMock.mockResolvedValue(true);
    fetchDiscordThreadContextMock.mockResolvedValue(undefined);
    dedupeMock.mockReturnValue(false);
  });

  it('queues a mention job using the first repo base branch as fallback git ref', async () => {
    const message = {
      id: 'M1',
      content: '<@123> hello there',
      channelId: 'C1',
      guildId: 'G1',
      author: { id: 'U1' },
      member: { id: 'U1' },
      client: { user: { id: 'BOT' } },
      mentions: { has: vi.fn().mockReturnValue(true) },
      channel: {
        isThread: () => false,
        messages: { cache: new Map() },
      },
      react: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      startThread: vi.fn(),
    } as never;

    const config = {
      primaryAgent: 'codex',
      repoAllowlist: {
        'repo-1': { baseBranch: 'experimental' },
        'repo-2': { baseBranch: 'develop' },
      },
    } as never;

    await handleMention(message, config, {} as never, {} as never);

    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MENTION',
        repoKeys: ['repo-1', 'repo-2'],
        gitRef: 'experimental',
        requestText: 'hello there',
        channel: expect.objectContaining({
          provider: 'discord',
          channelId: 'C1',
          userId: 'U1',
          guildId: 'G1',
        }),
      }),
    );
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });
});
