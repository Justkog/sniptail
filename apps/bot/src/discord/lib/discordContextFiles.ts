import type { Attachment, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import {
  isAllowedContextFile,
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
} from '../../lib/contextFilePolicy.js';

export const DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES = [
  'context_file_1',
  'context_file_2',
  'context_file_3',
] as const;

export type DiscordContextAttachmentRef = {
  id: string;
  name: string;
  url: string;
  mediaType?: string;
  byteSize: number;
};

function toContextAttachmentRef(attachment: Attachment): DiscordContextAttachmentRef | undefined {
  const attachmentId = attachment.id?.trim();
  const attachmentUrl = attachment.url?.trim();
  const attachmentName = attachment.name?.trim();

  if (!attachmentId || !attachmentUrl || !attachmentName) {
    logger.warn(
      {
        attachmentId,
        hasUrl: Boolean(attachmentUrl),
        hasName: Boolean(attachmentName),
      },
      'Discord attachment metadata is incomplete for context file upload',
    );
    return undefined;
  }

  return {
    id: attachmentId,
    name: attachmentName,
    url: attachmentUrl,
    ...(attachment.contentType?.trim() ? { mediaType: attachment.contentType.trim() } : {}),
    byteSize: attachment.size,
  };
}

export function getDiscordCommandContextAttachments(
  interaction: ChatInputCommandInteraction,
): DiscordContextAttachmentRef[] {
  const attachments = DISCORD_CONTEXT_ATTACHMENT_OPTION_NAMES.map((optionName) =>
    interaction.options.getAttachment(optionName),
  )
    .flatMap((attachment) => (attachment ? [attachment] : []))
    .map(toContextAttachmentRef)
    .flatMap((attachment) => (attachment ? [attachment] : []));

  if (!attachments.length) {
    return [];
  }

  const seenAttachmentIds = new Set<string>();
  return attachments.filter((attachment) => {
    if (seenAttachmentIds.has(attachment.id)) {
      return false;
    }
    seenAttachmentIds.add(attachment.id);
    return true;
  });
}

async function downloadDiscordContextAttachment(attachment: DiscordContextAttachmentRef): Promise<Buffer> {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Discord file download failed (${response.status}).`);
  }

  const content = Buffer.from(await response.arrayBuffer());
  if (!content.byteLength) {
    throw new Error(`${attachment.name} is empty.`);
  }

  return content;
}

export async function loadDiscordContextFiles(
  attachments: DiscordContextAttachmentRef[],
): Promise<JobContextFile[]> {
  if (!attachments.length) {
    return [];
  }
  if (attachments.length > MAX_CONTEXT_FILES) {
    throw new Error(`Attach at most ${MAX_CONTEXT_FILES} files.`);
  }

  let totalBytes = 0;
  const contextFiles: JobContextFile[] = [];

  for (const attachment of attachments) {
    const fileName = attachment.name.trim() || `discord-file-${attachment.id}`;
    if (!isAllowedContextFile({ fileName, mediaType: attachment.mediaType })) {
      throw new Error(`Unsupported file type for ${fileName}. Use images or small text files.`);
    }
    if (attachment.byteSize > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(`${fileName} exceeds the ${Math.floor(MAX_CONTEXT_FILE_BYTES / (1024 * 1024))} MiB limit.`);
    }

    const content = await downloadDiscordContextAttachment(attachment);
    if (content.byteLength > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(`${fileName} exceeds the ${Math.floor(MAX_CONTEXT_FILE_BYTES / (1024 * 1024))} MiB limit.`);
    }

    totalBytes += content.byteLength;
    if (totalBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw new Error(
        `Attached files exceed the ${Math.floor(MAX_CONTEXT_TOTAL_BYTES / (1024 * 1024))} MiB total limit.`,
      );
    }

    const sourceMetadata: Record<string, string> = {};
    if (attachment.mediaType?.trim()) {
      sourceMetadata.mediaType = attachment.mediaType.trim();
    }

    contextFiles.push({
      originalName: fileName,
      mediaType: attachment.mediaType?.trim() || 'application/octet-stream',
      byteSize: content.byteLength,
      contentBase64: content.toString('base64'),
      source: {
        provider: 'discord',
        externalId: attachment.id,
        ...(Object.keys(sourceMetadata).length ? { metadata: sourceMetadata } : {}),
      },
    });
  }

  return contextFiles;
}