import type { ChannelRef } from '@sniptail/core/types/channel.js';

export type FileUpload = {
  title: string;
  filePath?: string;
  fileContent?: string;
};

export type MessageOptions = {
  blocks?: unknown[];
  components?: unknown[];
};

export interface Notifier {
  postMessage(ref: ChannelRef, text: string, options?: MessageOptions): Promise<void>;
  uploadFile(ref: ChannelRef, file: FileUpload): Promise<void>;
}
