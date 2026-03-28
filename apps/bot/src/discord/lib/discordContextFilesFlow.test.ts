import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDiscordCommandContextAttachments,
  getDiscordMessageContextAttachments,
  loadDiscordContextFiles,
} from './discordContextFiles.js';

describe('discordContextFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts attachments from command options in declared order', () => {
    const interaction = {
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
          if (optionName === 'context_file_2') {
            return {
              id: 'A2',
              name: 'notes.md',
              url: 'https://example.test/A2',
              contentType: 'text/markdown',
              size: 8,
            };
          }
          return null;
        }),
      },
    } as never;

    expect(getDiscordCommandContextAttachments(interaction)).toEqual([
      {
        id: 'A1',
        name: 'diagram.png',
        url: 'https://example.test/A1',
        mediaType: 'image/png',
        byteSize: 7,
      },
      {
        id: 'A2',
        name: 'notes.md',
        url: 'https://example.test/A2',
        mediaType: 'text/markdown',
        byteSize: 8,
      },
    ]);
  });

  it('extracts attachments from a Discord message collection', () => {
    const message = {
      attachments: new Map([
        [
          'A1',
          {
            id: 'A1',
            name: 'diagram.png',
            url: 'https://example.test/A1',
            contentType: 'image/png',
            size: 7,
          },
        ],
        [
          'A2',
          {
            id: 'A2',
            name: 'notes.md',
            url: 'https://example.test/A2',
            contentType: 'text/markdown',
            size: 8,
          },
        ],
      ]),
    } as never;

    expect(getDiscordMessageContextAttachments(message)).toEqual([
      {
        id: 'A1',
        name: 'diagram.png',
        url: 'https://example.test/A1',
        mediaType: 'image/png',
        byteSize: 7,
      },
      {
        id: 'A2',
        name: 'notes.md',
        url: 'https://example.test/A2',
        mediaType: 'text/markdown',
        byteSize: 8,
      },
    ]);
  });

  it('downloads Discord attachments into JobContextFile payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('pngdata')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = await loadDiscordContextFiles([
      {
        id: 'A1',
        name: 'diagram.png',
        url: 'https://example.test/A1',
        mediaType: 'image/png',
        byteSize: 7,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/A1');
    expect(files).toEqual([
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

  it('rejects unsupported Discord attachment types before downloading', async () => {
    await expect(
      loadDiscordContextFiles([
        {
          id: 'A1',
          name: 'archive.zip',
          url: 'https://example.test/A1',
          mediaType: 'application/zip',
          byteSize: 7,
        },
      ]),
    ).rejects.toThrow('Unsupported file type for archive.zip. Use images or small text files.');
  });
});
