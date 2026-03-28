import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMention } from './mention.js';

const enqueueJobMock = vi.hoisted(() => vi.fn());
const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const getDiscordMessageContextAttachmentsMock = vi.hoisted(() => vi.fn());
const loadDiscordContextFilesMock = vi.hoisted(() => vi.fn());
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

vi.mock('../../lib/discordContextFiles.js', () => ({
  getDiscordMessageContextAttachments: getDiscordMessageContextAttachmentsMock,
  loadDiscordContextFiles: loadDiscordContextFilesMock,
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
    getDiscordMessageContextAttachmentsMock.mockReturnValue([]);
    loadDiscordContextFilesMock.mockResolvedValue([]);
  });

  it('queues a mention job without attaching allowlisted repos', async () => {
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
        repoKeys: [],
        gitRef: 'staging',
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

  it('attaches context files from the triggering Discord mention message', async () => {
    const message = {
      id: 'M2',
      content: '<@123> review this',
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
      attachments: new Map(),
    } as never;
    const attachments = [
      {
        id: 'A1',
        name: 'notes.md',
        url: 'https://example.test/A1',
        mediaType: 'text/markdown',
        byteSize: 12,
      },
    ];
    getDiscordMessageContextAttachmentsMock.mockReturnValue(attachments);
    loadDiscordContextFilesMock.mockResolvedValue([
      {
        originalName: 'notes.md',
        mediaType: 'text/markdown',
        byteSize: 12,
        contentBase64: 'bm90ZXM=',
        source: {
          provider: 'discord',
          externalId: 'A1',
        },
      },
    ]);

    const config = {
      primaryAgent: 'codex',
      repoAllowlist: {},
    } as never;

    await handleMention(message, config, {} as never, {} as never);

    expect(getDiscordMessageContextAttachmentsMock).toHaveBeenCalledWith(message);
    expect(loadDiscordContextFilesMock).toHaveBeenCalledWith(attachments);
    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contextFiles: [
          expect.objectContaining({
            originalName: 'notes.md',
          }),
        ],
      }),
    );
  });

  it('replies with an error when Discord mention attachments cannot be used', async () => {
    const message = {
      id: 'M3',
      content: '<@123> bad file',
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
      attachments: new Map(),
    } as never;

    getDiscordMessageContextAttachmentsMock.mockReturnValue([
      {
        id: 'A9',
        name: 'archive.zip',
        url: 'https://example.test/A9',
        mediaType: 'application/zip',
        byteSize: 12,
      },
    ]);
    loadDiscordContextFilesMock.mockRejectedValue(new Error('Unsupported file type for archive.zip.'));

    await handleMention(
      message,
      {
        primaryAgent: 'codex',
        repoAllowlist: {},
      } as never,
      {} as never,
      {} as never,
    );

    expect(message.reply).toHaveBeenCalledWith(
      "I couldn't use the attached files: Unsupported file type for archive.zip.",
    );
    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
