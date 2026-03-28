import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAskStart } from './commands/ask.js';
import { handleAskSelection } from './actions/askSelection.js';
import { askSelectionByUser } from '../state.js';

const refreshRepoAllowlistMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/repoAllowlist.js', () => ({
  refreshRepoAllowlist: refreshRepoAllowlistMock,
}));

describe('Discord ask attachment flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askSelectionByUser.clear();
    refreshRepoAllowlistMock.mockResolvedValue(undefined);
  });

  it('preserves command attachments through repo selection before opening the modal', async () => {
    const config = {
      botName: 'Sniptail',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
        'repo-b': { baseBranch: 'develop' },
      },
    } as never;

    const reply = vi
      .fn<
        (payload: { content: string; components: unknown[]; ephemeral: boolean }) => Promise<void>
      >()
      .mockResolvedValue(undefined);
    const showModal = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const commandInteraction = {
      user: { id: 'U1' },
      options: {
        getAttachment: vi.fn((optionName: string) => {
          if (optionName === 'context_file_1') {
            return {
              id: 'A1',
              name: 'diagram.png',
              url: 'https://example.test/A1',
              contentType: 'image/png',
              size: 7,
            };
          }
          return null;
        }),
      },
      reply,
      showModal,
    } as never;

    await handleAskStart(commandInteraction, config);

    const replyPayload = reply.mock.calls[0]?.[0];
    expect(replyPayload).toMatchObject({
      content: 'Select repositories for your question.',
      ephemeral: true,
    });
    expect(replyPayload?.components).toBeInstanceOf(Array);
    expect(askSelectionByUser.get('U1')).toEqual(
      expect.objectContaining({
        repoKeys: [],
        contextAttachments: [
          {
            id: 'A1',
            name: 'diagram.png',
            url: 'https://example.test/A1',
            mediaType: 'image/png',
            byteSize: 7,
          },
        ],
      }),
    );

    const selectionInteraction = {
      user: { id: 'U1' },
      values: ['repo-a'],
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
    } as never;

    await handleAskSelection(selectionInteraction, config);

    expect(selectionInteraction.showModal).toHaveBeenCalledTimes(1);
    expect(askSelectionByUser.get('U1')).toEqual(
      expect.objectContaining({
        repoKeys: ['repo-a'],
        contextAttachments: [
          {
            id: 'A1',
            name: 'diagram.png',
            url: 'https://example.test/A1',
            mediaType: 'image/png',
            byteSize: 7,
          },
        ],
      }),
    );
  });
});
