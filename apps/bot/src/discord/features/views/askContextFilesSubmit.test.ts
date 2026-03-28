import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { loadDiscordContextFiles } from '../../lib/discordContextFiles.js';
import type { fetchDiscordThreadContext } from '../../threadContext.js';
import { handleAskModalSubmit } from './askSubmit.js';
import { askSelectionByUser } from '../../state.js';

type DiscordContextFilesModule = Record<string, unknown> & {
  loadDiscordContextFiles: typeof loadDiscordContextFiles;
};

type DiscordThreadContextModule = Record<string, unknown> & {
  fetchDiscordThreadContext: typeof fetchDiscordThreadContext;
};

const enqueueJobMock = vi.hoisted(() => vi.fn());
const saveJobQueuedMock = vi.hoisted(() => vi.fn<(job: JobSpec) => Promise<void>>());
const refreshRepoAllowlistMock = vi.hoisted(() => vi.fn());
const postDiscordJobAcceptanceMock = vi.hoisted(() => vi.fn());
const fetchDiscordThreadContextMock = vi.hoisted(() => vi.fn());
const authorizeDiscordOperationAndRespondMock = vi.hoisted(() => vi.fn());
const loadDiscordContextFilesMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('../../../lib/repoAllowlist.js', () => ({
  refreshRepoAllowlist: refreshRepoAllowlistMock,
}));

vi.mock('../../lib/threads.js', () => ({
  postDiscordJobAcceptance: postDiscordJobAcceptanceMock,
}));

vi.mock('../../threadContext.js', async () => {
  const actual = await vi.importActual<DiscordThreadContextModule>('../../threadContext.js');
  return {
    ...actual,
    fetchDiscordThreadContext: fetchDiscordThreadContextMock,
  };
});

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: authorizeDiscordOperationAndRespondMock,
}));

vi.mock('../../lib/discordContextFiles.js', async () => {
  const actual = await vi.importActual<DiscordContextFilesModule>(
    '../../lib/discordContextFiles.js',
  );
  return {
    ...actual,
    loadDiscordContextFiles: loadDiscordContextFilesMock,
  };
});

describe('handleAskModalSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askSelectionByUser.clear();
    enqueueJobMock.mockResolvedValue(undefined);
    saveJobQueuedMock.mockResolvedValue(undefined);
    refreshRepoAllowlistMock.mockResolvedValue(undefined);
    postDiscordJobAcceptanceMock.mockResolvedValue({ acceptancePosted: false });
    fetchDiscordThreadContextMock.mockResolvedValue(undefined);
    authorizeDiscordOperationAndRespondMock.mockResolvedValue(true);
    loadDiscordContextFilesMock.mockResolvedValue([
      {
        originalName: 'diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
        contentBase64: Buffer.from('pngdata').toString('base64'),
        source: {
          provider: 'discord',
          externalId: 'A1',
          metadata: { mediaType: 'image/png' },
        },
      },
    ]);
  });

  it('queues ask jobs with Discord context files from the command selection state', async () => {
    askSelectionByUser.set('U1', {
      repoKeys: ['repo-a'],
      requestedAt: Date.now(),
      contextAttachments: [
        {
          id: 'A1',
          name: 'diagram.png',
          url: 'https://example.test/A1',
          mediaType: 'image/png',
          byteSize: 7,
        },
      ],
    });

    const editReply = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'U1' },
      channelId: 'C1',
      guildId: 'G1',
      member: { id: 'U1' },
      client: {},
      fields: {
        getTextInputValue: vi.fn((field: string) => {
          if (field === 'git_ref') return 'main';
          if (field === 'question') return 'What changed?';
          if (field === 'resume_from') return '';
          return '';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply,
      reply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
    } as never;

    const config = {
      botName: 'Sniptail',
      primaryAgent: 'codex',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
      },
    } as never;

    await handleAskModalSubmit(interaction, config, {} as never, {} as never);

    expect(loadDiscordContextFilesMock).toHaveBeenCalledWith([
      {
        id: 'A1',
        name: 'diagram.png',
        url: 'https://example.test/A1',
        mediaType: 'image/png',
        byteSize: 7,
      },
    ]);
    const savedJob = saveJobQueuedMock.mock.calls[0]?.[0];
    expect(savedJob).toMatchObject({
      type: 'ASK',
      repoKeys: ['repo-a'],
      requestText: 'What changed?',
    });
    expect(savedJob?.contextFiles).toEqual([
      {
        originalName: 'diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
        contentBase64: Buffer.from('pngdata').toString('base64'),
        source: {
          provider: 'discord',
          externalId: 'A1',
          metadata: { mediaType: 'image/png' },
        },
      },
    ]);
    expect(savedJob?.channel).toMatchObject({
      provider: 'discord',
      channelId: 'C1',
      userId: 'U1',
      guildId: 'G1',
    });
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
    expect(editReply.mock.calls[0]?.[0]).toContain("I've accepted job");
  });
});
