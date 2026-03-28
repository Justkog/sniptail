import { extname } from 'node:path';

export const CONTEXT_FILE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
] as const;

export const MAX_CONTEXT_FILES = 3;
export const MAX_CONTEXT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CONTEXT_TOTAL_BYTES = 6 * 1024 * 1024;

const allowedContextMimeTypes = new Set([
  'application/json',
  'application/x-yaml',
  'application/yaml',
]);

export function isAllowedContextFile(input: {
  fileName?: string | undefined;
  mediaType?: string | undefined;
}): boolean {
  const mediaType = input.mediaType?.trim().toLowerCase();
  if (mediaType?.startsWith('image/') || mediaType?.startsWith('text/')) {
    return true;
  }
  if (mediaType && allowedContextMimeTypes.has(mediaType)) {
    return true;
  }

  const fileExtension = extname(input.fileName ?? '')
    .replace(/^\./, '')
    .trim()
    .toLowerCase();
  return fileExtension ? CONTEXT_FILE_EXTENSIONS.includes(fileExtension as never) : false;
}
