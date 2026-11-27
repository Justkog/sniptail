import type {
  JobThreadContextCursor,
  JobThreadContextMessage,
  JobThreadContextSnapshot,
} from '../types/job.js';
import type { ChannelContext } from '../types/channel.js';

const maxThreadHistoryMessages = 20;
const maxThreadHistoryChars = 4000;

export type ThreadContextSnapshotData = {
  threadContext: string;
  threadContextSnapshot: JobThreadContextSnapshot;
};

export type NormalizedThreadContextSnapshot = {
  threadContext?: string;
  threadContextSnapshot?: JobThreadContextSnapshot;
};

export type BoundedThreadContextMessages = {
  messages: JobThreadContextMessage[];
  rendered: string;
  truncated: boolean;
};

export function renderThreadContextMessages(messages: JobThreadContextMessage[]): string {
  return messages.map((message) => `${message.author}: ${message.text}`).join('\n');
}

function clipMessage(
  message: JobThreadContextMessage,
  maxRenderedLength: number,
): JobThreadContextMessage | undefined {
  const prefix = `${message.author}: `;
  const maxTextLength = maxRenderedLength - prefix.length;
  if (maxTextLength <= 0) return undefined;
  if (message.text.length <= maxTextLength) return message;
  const text =
    maxTextLength > 3
      ? `...${message.text.slice(-(maxTextLength - 3))}`
      : message.text.slice(-maxTextLength);
  return { ...message, text };
}

export function boundThreadContextMessages(
  messages: JobThreadContextMessage[],
  maxChars = maxThreadHistoryChars,
): BoundedThreadContextMessages {
  const retainedCandidates = messages.slice(-maxThreadHistoryMessages);
  const boundedMessages: JobThreadContextMessage[] = [];
  let truncated = retainedCandidates.length < messages.length;

  for (let index = retainedCandidates.length - 1; index >= 0; index -= 1) {
    const message = retainedCandidates[index]!;
    const candidate = [message, ...boundedMessages];
    if (renderThreadContextMessages(candidate).length <= maxChars) {
      boundedMessages.unshift(message);
      continue;
    }

    truncated = true;
    const existing = renderThreadContextMessages(boundedMessages);
    const available = maxChars - existing.length - (existing ? 1 : 0);
    const clipped = clipMessage(message, available);
    if (clipped) {
      boundedMessages.unshift(clipped);
    }
    break;
  }

  return {
    messages: boundedMessages,
    rendered: renderThreadContextMessages(boundedMessages),
    truncated,
  };
}

export function buildThreadContextSnapshot(input: {
  provider: ChannelContext['provider'];
  channelId: string;
  threadId: string;
  messages: JobThreadContextMessage[];
  coversAvailableHistory: boolean;
  cursorMessage?: {
    messageId: string;
    orderKey: string;
  };
}): ThreadContextSnapshotData | undefined {
  const bounded = boundThreadContextMessages(input.messages);
  const cursorSource = input.cursorMessage
    ? input.cursorMessage
    : bounded.messages.at(-1)
      ? {
          messageId: bounded.messages.at(-1)!.externalId,
          orderKey: bounded.messages.at(-1)!.orderKey,
        }
      : undefined;
  if (!bounded.messages.length && !cursorSource) return undefined;

  const cursor: JobThreadContextCursor | undefined = cursorSource
    ? {
        provider: input.provider,
        channelId: input.channelId,
        threadId: input.threadId,
        messageId: cursorSource.messageId,
        orderKey: cursorSource.orderKey,
      }
    : undefined;
  return {
    threadContext: bounded.rendered,
    threadContextSnapshot: {
      version: 1,
      provider: input.provider,
      channelId: input.channelId,
      threadId: input.threadId,
      messages: bounded.messages,
      rendered: bounded.rendered,
      coversThreadRoot: input.coversAvailableHistory && !bounded.truncated,
      ...(cursor ? { cursor } : {}),
    },
  };
}

export function normalizeThreadContextResult(
  result: string | ThreadContextSnapshotData | undefined,
): NormalizedThreadContextSnapshot {
  if (!result) return {};
  if (typeof result === 'string') return { threadContext: result };
  return result;
}
