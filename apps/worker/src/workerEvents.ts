import { fetchCodexUsageMessage } from '@sniptail/core/codex/status.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent, WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from './channels/botEventSink.js';
import { resolveWorkerChannelAdapter } from './channels/workerChannelAdapters.js';
import type { JobRegistry } from './job/jobRegistry.js';

async function publishCodexUsageStatus(
  event: CoreWorkerEvent<'status.codexUsage'>,
  message: string,
  botEvents: BotEventSink,
) {
  const adapter = resolveWorkerChannelAdapter(event.payload.provider);
  const replyEvent = adapter.buildCodexUsageReplyEvent({
    ...(event.requestId ? { requestId: event.requestId } : {}),
    payload: event.payload,
    text: message,
  });
  if (!replyEvent) {
    logger.warn({ event }, 'Channel adapter cannot render Codex usage response');
    return;
  }
  await botEvents.publish(replyEvent);
}

export async function handleWorkerEvent(
  event: WorkerEvent,
  registry: JobRegistry,
  botEvents: BotEventSink,
): Promise<void> {
  switch (event.type) {
    case 'jobs.clear': {
      const { jobId, ttlMs } = event.payload;
      await registry.markJobForDeletion(jobId, ttlMs).catch((err) => {
        logger.error({ err, jobId }, 'Failed to schedule job deletion');
      });
      return;
    }
    case 'jobs.clearBefore': {
      const cutoff = new Date(event.payload.cutoffIso);
      if (Number.isNaN(cutoff.getTime())) {
        logger.warn({ cutoffIso: event.payload.cutoffIso }, 'Invalid cutoff date');
        return;
      }
      await registry.clearJobsBefore(cutoff).catch((err) => {
        logger.error({ err, cutoffIso: event.payload.cutoffIso }, 'Failed to clear jobs');
      });
      return;
    }
    case 'status.codexUsage': {
      try {
        const { message } = await fetchCodexUsageMessage();
        await publishCodexUsageStatus(event, message, botEvents);
      } catch (err) {
        logger.error({ err }, 'Failed to fetch Codex usage status');
        await publishCodexUsageStatus(
          event,
          'Failed to fetch Codex usage status. Please try again shortly.',
          botEvents,
        );
      }
      return;
    }
    default:
      logger.warn({ event }, 'Unknown worker event received');
  }
}
