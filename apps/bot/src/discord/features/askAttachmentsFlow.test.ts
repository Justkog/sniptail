import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAskStart } from './commands/ask.js';
import { handleAskSelection } from './actions/askSelection.js';
import { askSelectionByUser, DISCORD_SELECTION_CAPTURED_MESSAGE } from '../state.js';

const refreshRepoAllowlistMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/repoAllowlist.js', () => ({
  refreshRepoAllowlist: refreshRepoAllowlistMock,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

describe('Discord ask attachment flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askSelectionByUser.clear();
    refreshRepoAllowlistMock.mockResolvedValue(undefined);
  });

  it('preserves command attachments through repo selection and disables the selector reply', async () => {
    const config = {
      botName: 'Sniptail',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
        'repo-b': { baseBranch: 'develop' },
      },
    } as never;

    const reply = vi
      .fn<
        (payload: {
          content: string;
          components: unknown[];
          ephemeral: boolean;
          withResponse?: boolean;
        }) => Promise<{ resource: { message: { id: string } } }>
      >()
      .mockResolvedValue({ resource: { message: { id: 'M1' } } });
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
      withResponse: true,
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
        selectorMessageId: 'M1',
      }),
    );

    const selectorEdit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const selectionInteraction = {
      user: { id: 'U1' },
      values: ['repo-a'],
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
      message: {
        id: 'M1',
        edit: selectorEdit,
      },
      webhook: {
        editMessage: vi.fn(),
      },
    } as never;

    await handleAskSelection(selectionInteraction, config);

    expect(selectionInteraction.showModal).toHaveBeenCalledTimes(1);
    expect(selectorEdit).toHaveBeenCalledWith({
      content: DISCORD_SELECTION_CAPTURED_MESSAGE,
      components: [],
    });
    expect(askSelectionByUser.get('U1')).toEqual(
      expect.objectContaining({
        repoKeys: ['repo-a'],
        selectorMessageId: 'M1',
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

  it('logs a warning and still opens the modal when selector cleanup fails', async () => {
    const config = {
      botName: 'Sniptail',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
        'repo-b': { baseBranch: 'develop' },
      },
    } as never;

    askSelectionByUser.set('U1', {
      repoKeys: [],
      requestedAt: Date.now(),
      selectorMessageId: 'M1',
    });

    const selectionInteraction = {
      user: { id: 'U1' },
      values: ['repo-a'],
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
      message: {
        id: 'M1',
        edit: vi.fn().mockRejectedValue(new Error('nope')),
      },
      webhook: {
        editMessage: vi.fn().mockRejectedValue(new Error('still nope')),
      },
    } as never;

    await handleAskSelection(selectionInteraction, config);

    expect(selectionInteraction.showModal).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it('expires stale repo selections before opening the modal', async () => {
    const config = {
      botName: 'Sniptail',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
        'repo-b': { baseBranch: 'develop' },
      },
    } as never;

    const selectorEdit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    askSelectionByUser.set('U1', {
      repoKeys: [],
      requestedAt: Date.now() - 16 * 60 * 1000,
      selectorMessageId: 'M1',
    });

    const selectionInteraction = {
      user: { id: 'U1' },
      values: ['repo-a'],
      reply,
      showModal: vi.fn().mockResolvedValue(undefined),
      message: {
        id: 'M1',
        edit: selectorEdit,
      },
      webhook: {
        editMessage: vi.fn(),
      },
    } as never;

    await handleAskSelection(selectionInteraction, config);

    expect(selectionInteraction.showModal).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      content: 'Repository selection expired. Please run the ask command again.',
      ephemeral: true,
    });
    expect(selectorEdit).toHaveBeenCalledWith({
      content: 'Repository selection expired. Please rerun the ask command.',
      components: [],
    });
    expect(askSelectionByUser.has('U1')).toBe(false);
  });

  it('does not capture selector metadata when only one repo is allowlisted', async () => {
    const config = {
      botName: 'Sniptail',
      repoAllowlist: {
        'repo-a': { baseBranch: 'main' },
      },
    } as never;

    const commandInteraction = {
      user: { id: 'U1' },
      options: {
        getAttachment: vi.fn().mockReturnValue(null),
      },
      reply: vi.fn().mockResolvedValue({ resource: { message: { id: 'M1' } } }),
      showModal: vi.fn().mockResolvedValue(undefined),
    } as never;

    await handleAskStart(commandInteraction, config);

    expect(commandInteraction.showModal).toHaveBeenCalledTimes(1);
    expect(commandInteraction.reply).not.toHaveBeenCalled();
    expect(askSelectionByUser.get('U1')).toEqual(
      expect.objectContaining({
        repoKeys: ['repo-a'],
      }),
    );
    expect(askSelectionByUser.get('U1')?.selectorMessageId).toBeUndefined();
  });
});
