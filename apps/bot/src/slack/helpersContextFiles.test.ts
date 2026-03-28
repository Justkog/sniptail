import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSlackModalContextFiles } from './helpers.js';

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