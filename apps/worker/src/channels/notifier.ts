export type ChannelRef = {
  channelId: string;
  threadId?: string;
};

export type FileUpload = {
  title: string;
  filePath: string;
};

export type MessageOptions = {
  blocks?: unknown[];
};

export interface Notifier {
  postMessage(ref: ChannelRef, text: string, options?: MessageOptions): Promise<void>;
  uploadFile(ref: ChannelRef, file: FileUpload): Promise<void>;
}
