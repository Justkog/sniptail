import type {
  AgentId,
  JobSpec,
  JobThreadContextCursor,
  JobThreadContextSnapshot,
} from '@sniptail/core/types/job.js';
import { boundThreadContextMessages } from '@sniptail/core/channels/threadContextSnapshot.js';

export type ContinuationContextMode = 'delta' | 'full' | 'empty';

export type ContinuationContextResult = {
  mode: ContinuationContextMode;
  reason:
    | 'cursor'
    | 'missing_cursor'
    | 'incompatible_cursor'
    | 'uncertain_coverage'
    | 'legacy_snapshot_missing';
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

export function buildContinuationContext(
  job: JobSpec,
  sourceCursor: JobThreadContextCursor | undefined,
  providerSessionResumed = true,
): ContinuationContextResult {
  const snapshot = job.threadContextSnapshot;

  if (!snapshot) {
    const retainSourceCursor =
      providerSessionResumed &&
      sourceCursor?.provider === job.channel.provider &&
      sourceCursor.channelId === job.channel.channelId &&
      sourceCursor.threadId === (job.channel.threadId ?? job.channel.channelId);
    return {
      mode: job.threadContext ? 'full' : 'empty',
      reason: 'legacy_snapshot_missing',
      ...(job.threadContext ? { rendered: job.threadContext } : {}),
      messageCount: job.threadContext ? 1 : 0,
      ...(retainSourceCursor && sourceCursor ? { cursor: sourceCursor } : {}),
    };
  }

  if (!sourceCursor) {
    const cursor = snapshot.coversThreadRoot ? snapshot.cursor : undefined;
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
    };
  }

  if (!snapshot.coversThreadRoot) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'uncertain_coverage',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      cursor: sourceCursor,
    };
  }

  const sourceIndex = snapshot.messages.findIndex(
    (message) => message.externalId === sourceCursor.messageId,
  );
  const sourceMatchesSnapshotCursor =
    snapshot.cursor?.messageId === sourceCursor.messageId &&
    snapshot.cursor?.orderKey === sourceCursor.orderKey;
  if (sourceIndex < 0 && !sourceMatchesSnapshotCursor) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'cursor',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      ...(snapshot.cursor ? { cursor: snapshot.cursor } : {}),
    };
  }

  const messages = sourceIndex >= 0 ? snapshot.messages.slice(sourceIndex + 1) : [];
  const boundedDelta = boundThreadContextMessages(messages);
  if (boundedDelta.truncated) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'uncertain_coverage',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: messages.length,
      ...(sourceCursor ? { cursor: sourceCursor } : {}),
    };
  }
  return {
    mode: boundedDelta.rendered ? 'delta' : 'empty',
    reason: 'cursor',
    ...(boundedDelta.rendered ? { rendered: boundedDelta.rendered } : {}),
    messageCount: messages.length,
    ...(snapshot.cursor ? { cursor: snapshot.cursor } : {}),
  };
}

export function getAgentThreadContextCursor(
  job: JobSpec | undefined,
  agentId: AgentId,
): JobThreadContextCursor | undefined {
  return job?.agentThreadContextCursors?.[agentId];
}
