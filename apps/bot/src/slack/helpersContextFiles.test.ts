import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSlackMentionContextFiles, loadSlackModalContextFiles } from './helpers.js';

describe('loadSlackModalContextFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads uploaded file ids from file_input view state files', async () => {
    const filesInfo = vi.fn().mockResolvedValue({
      file: {
        id: 'F123',
        name: 'diagram.png',
        mimetype: 'image/png',
        filetype: 'png',
        size: 7,
        url_private_download: 'https://example.test/F123',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from('pngdata')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = await loadSlackModalContextFiles({
      client: {
        files: {
          info: filesInfo,
        },
      } as never,
      botToken: 'xoxb-test',
      state: {
        context_files: {
          context_files: {
            files: [{ id: ' F123 ' }],
          },
        },
      },
    });

    expect(filesInfo).toHaveBeenCalledWith({ file: 'F123' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/F123', {
      headers: { Authorization: 'Bearer xoxb-test' },
    });
    expect(files).toEqual([
      {
        originalName: 'diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
        contentBase64: Buffer.from('pngdata').toString('base64'),
        source: {
          provider: 'slack',
          externalId: 'F123',
          metadata: { filetype: 'png' },
        },
      },
    ]);
  });
});

describe('loadSlackMentionContextFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads files from the exact triggering Slack message only', async () => {
    const conversationsReplies = vi.fn().mockResolvedValue({
      messages: [
        {
          ts: '111.222',
          files: [{ id: 'F123' }, { id: 'F124' }],
        },
      ],
    });
    const filesInfo = vi
      .fn()
      .mockResolvedValueOnce({
        file: {
          id: 'F123',
          name: 'notes.md',
          mimetype: 'text/markdown',
          filetype: 'md',
          size: 5,
          url_private_download: 'https://example.test/F123',
        },
      })
      .mockResolvedValueOnce({
        file: {
          id: 'F124',
          name: 'diagram.png',
          mimetype: 'image/png',
          filetype: 'png',
          size: 7,
          url_private_download: 'https://example.test/F124',
        },
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('notes')),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('pngdata')),
      });
    vi.stubGlobal('fetch', fetchMock);

    const files = await loadSlackMentionContextFiles({
      client: {
        conversations: {
          replies: conversationsReplies,
        },
        files: {
          info: filesInfo,
        },
      } as never,
      botToken: 'xoxb-test',
      channelId: 'C1',
      threadTs: '111.111',
      messageTs: '111.222',
    });

    expect(conversationsReplies).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '111.111',
      oldest: '111.222',
      inclusive: true,
      limit: 1,
    });
    expect(filesInfo).toHaveBeenNthCalledWith(1, { file: 'F123' });
    expect(filesInfo).toHaveBeenNthCalledWith(2, { file: 'F124' });
    expect(files).toEqual([
      {
        originalName: 'notes.md',
        mediaType: 'text/markdown',
        byteSize: 5,
        contentBase64: Buffer.from('notes').toString('base64'),
        source: {
          provider: 'slack',
          externalId: 'F123',
          metadata: { filetype: 'md' },
        },
      },
      {
        originalName: 'diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
        contentBase64: Buffer.from('pngdata').toString('base64'),
        source: {
          provider: 'slack',
          externalId: 'F124',
          metadata: { filetype: 'png' },
        },
      },
    ]);
  });
});