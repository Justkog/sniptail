import type { ChannelRef } from '@sniptail/core/types/channel.js';
import type { JobSpec, JobThreadContextCursor } from '@sniptail/core/types/job.js';
import { boundThreadContextMessages } from '@sniptail/core/channels/threadContextSnapshot.js';

export type ContinuationContextMode = 'delta' | 'full' | 'empty';

export type ContinuationContextResult = {
  mode: ContinuationContextMode;
  reason:
    | 'cursor'
    | 'missing_cursor'
    | 'incompatible_cursor'
    | 'incompatible_snapshot'
    | 'uncertain_coverage'
    | 'legacy_snapshot_missing';
  rendered?: string;
  messageCount: number;
  cursor?: JobThreadContextCursor;
};

export function matchesThreadContextDestination(
  context: Pick<JobThreadContextCursor, 'provider' | 'channelId' | 'threadId'>,
  destination: ChannelRef,
): boolean {
  const threadId = destination.threadId ?? destination.channelId;
  const channelId = destination.provider === 'discord' ? threadId : destination.channelId;
  return (
    context.provider === destination.provider &&
    context.channelId === channelId &&
    context.threadId === threadId
  );
}

export function buildContinuationContext(
  job: JobSpec,
  sourceCursor: JobThreadContextCursor | undefined,
  providerSessionResumed = true,
  destination: ChannelRef = job.channel,
): ContinuationContextResult {
  const snapshot = job.threadContextSnapshot;
  const destinationCursor =
    providerSessionResumed &&
    sourceCursor &&
    matchesThreadContextDestination(sourceCursor, destination)
      ? sourceCursor
      : undefined;

  if (!snapshot) {
    return {
      mode: job.threadContext ? 'full' : 'empty',
      reason: 'legacy_snapshot_missing',
      ...(job.threadContext ? { rendered: job.threadContext } : {}),
      messageCount: job.threadContext ? 1 : 0,
      ...(destinationCursor ? { cursor: destinationCursor } : {}),
    };
  }

  if (!matchesThreadContextDestination(snapshot, destination)) {
    return {
      mode: 'empty',
      reason: 'incompatible_snapshot',
      messageCount: 0,
      ...(destinationCursor ? { cursor: destinationCursor } : {}),
    };
  }

  const snapshotCursor =
    snapshot.cursor && matchesThreadContextDestination(snapshot.cursor, destination)
      ? snapshot.cursor
      : undefined;
  if (!providerSessionResumed || !sourceCursor) {
    const cursor = snapshot.coversThreadRoot ? snapshotCursor : undefined;
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'missing_cursor',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      ...(cursor ? { cursor } : {}),
    };
  }

  if (!destinationCursor) {
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
      cursor: destinationCursor,
    };
  }

  const sourceIndex = snapshot.messages.findIndex(
    (message) => message.externalId === destinationCursor.messageId,
  );
  const sourceMatchesSnapshotCursor =
    snapshotCursor?.messageId === destinationCursor.messageId &&
    snapshotCursor?.orderKey === destinationCursor.orderKey;
  if (sourceIndex < 0 && !sourceMatchesSnapshotCursor) {
    return {
      mode: snapshot.rendered ? 'full' : 'empty',
      reason: 'cursor',
      ...(snapshot.rendered ? { rendered: snapshot.rendered } : {}),
      messageCount: snapshot.messages.length,
      ...(snapshotCursor ? { cursor: snapshotCursor } : {}),
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
      cursor: destinationCursor,
    };
  }
  return {
    mode: boundedDelta.rendered ? 'delta' : 'empty',
    reason: 'cursor',
    ...(boundedDelta.rendered ? { rendered: boundedDelta.rendered } : {}),
    messageCount: messages.length,
    ...(snapshotCursor ? { cursor: snapshotCursor } : {}),
  };
}
