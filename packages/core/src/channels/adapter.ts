import type { ChannelProvider } from '../types/channel.js';

export type ChannelCapability =
  | 'threads'
  | 'richTextBlocks'
  | 'richComponents'
  | 'ephemeralMessages'
  | 'interactionReplies'
  | 'fileUploads';

export type ChannelCapabilities = Readonly<Partial<Record<ChannelCapability, boolean>>>;

export interface ChannelAdapterBase {
  providerId: ChannelProvider;
  capabilities: ChannelCapabilities;
}

export interface BotChannelAdapter<EventType, RuntimeDeps> extends ChannelAdapterBase {
  handleEvent(event: EventType, runtime: RuntimeDeps): Promise<boolean>;
}

export interface WorkerChannelAdapter<
  RenderInput = unknown,
  RenderOutput = unknown,
> extends ChannelAdapterBase {
  renderCompletion?(input: RenderInput): RenderOutput;
}
