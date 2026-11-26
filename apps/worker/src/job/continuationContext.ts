import type { ChannelContext } from '@sniptail/core/types/channel.js';
import type {
  AgentId,
  JobSpec,
  JobThreadContextCursor,
  JobThreadContextMessage,
  JobThreadContextSnapshot,
} from '@sniptail/core/types/job.js';

const maxContinuationHistoryChars = 4000;

export type ContinuationContextMode = 'delta' | 'full' | 'empty';

export type ContinuationContextResult = {
  mode: ContinuationContextMode;
  reason: 'cursor' | 'missing_cursor' | 'incompatible_cursor' | 'legacy_snapshot_missing';
  rendered?: string;
  messageCount: number;
  cursor?: JobThreadContextCursor;
};

function sameChannel(left: JobThreadContextCursor, right: JobThreadContextSnapshot): boolean {
  return (
    left.provider === right.provider &&
    left.channelId === right.channelId &&
    left.threadId === right.threadId
  );
}

function compareNumericParts(left: string, right: string): number {
  const [leftWhole, leftFraction = ''] = left.split('.', 2);
  const [rightWhole, rightFraction = ''] = right.split('.', 2);
  const wholeComparison = BigInt(leftWhole || '0') - BigInt(rightWhole || '0');
  if (wholeComparison !== 0n) return wholeComparison < 0n ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction.padEnd(width, '0').localeCompare(rightFraction.padEnd(width, '0'));
}

function compareOrderKeys(left: string, right: string): number {
  try {
    return compareNumericParts(left, right);
  } catch {
    return left.localeCompare(right);
  }
}

function truncate(rendered: string): string {
  if (rendered.length <= maxContinuationHistoryChars) return rendered;
  return `...${rendered.slice(-maxContinuationHistoryChars)}`;
}

function render(messages: JobThreadContextMessage[]): string {
  return messages.map((message) => `${message.author}: ${message.text}`).join('\n');
}

function buildCursorFromChannel(
  job: JobSpec,
  snapshot: JobThreadContextSnapshot | undefined,
  channel: ChannelContext,
): JobThreadContextCursor | undefined {
  const messageId = channel.requestMessageId;
  if (messageId) {
    return {
      provider: snapshot?.provider ?? channel.provider,
      channelId: snapshot?.channelId ?? channel.channelId,
      threadId: snapshot?.threadId ?? channel.threadId ?? channel.channelId,
      messageId,
      orderKey: messageId,
    };
  }
  return snapshot?.cursor;
}

export function buildCurrentContinuationCursor(
  job: JobSpec,
  channel: ChannelContext = job.channel,
): JobThreadContextCursor | undefined {
  return buildCursorFromChannel(job, job.threadContextSnapshot, channel);
}

export function buildContinuationContext(
  job: JobSpec,
  sourceCursor: JobThreadContextCursor | undefined,
  currentChannel: ChannelContext = job.channel,
): ContinuationContextResult {
  const snapshot = job.threadContextSnapshot;
  const cursor = buildCurrentContinuationCursor(job, currentChannel);

  if (!snapshot) {
    return {
      mode: job.threadContext ? 'full' : 'empty',
      reason: 'legacy_snapshot_missing',
      ...(job.threadContext ? { rendered: job.threadContext } : {}),
      messageCount: job.threadContext ? 1 : 0,
      ...(cursor ? { cursor } : {}),
    };
  }

  if (!sourceCursor) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'missing_cursor',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      ...(cursor ? { cursor } : {}),
    };
  }

  if (!sameChannel(sourceCursor, snapshot)) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'incompatible_cursor',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      ...(cursor ? { cursor } : {}),
    };
  }

  const messages = snapshot.messages.filter(
    (message) => compareOrderKeys(message.orderKey, sourceCursor.orderKey) > 0,
  );
  const rendered = render(messages);
  return {
    mode: rendered ? 'delta' : 'empty',
    reason: 'cursor',
    ...(rendered ? { rendered: truncate(rendered) } : {}),
    messageCount: messages.length,
    ...(cursor ? { cursor } : {}),
  };
}

export function getAgentThreadContextCursor(
  job: JobSpec | undefined,
  agentId: AgentId,
): JobThreadContextCursor | undefined {
  return job?.agentThreadContextCursors?.[agentId];
}
