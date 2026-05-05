import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { fetchCodexUsageMessage } from '@sniptail/core/codex/status.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent, WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { publishAgentMetadataUpdate } from './agent-command/metadata.js';
import {
  runAgentSessionMessage,
  runAgentSessionStart,
} from './agent-command/agentSessionRunner.js';
import { resolveAgentInteraction } from './agent-command/resolveAgentInteraction.js';
import { stopAgentPrompt } from './agent-command/stopAgentPrompt.js';
import type { BotEventSink } from './channels/botEventSink.js';
import { createNotifier } from './channels/createNotifier.js';
import { resolveWorkerChannelAdapter } from './channels/workerChannelAdapters.js';
import type { JobRegistry } from './job/jobRegistry.js';
import {
  addRepoCatalogEntryFromInput,
  removeRepoCatalogEntryFromInput,
} from './repos/repoCatalogMutationService.js';

const config = loadWorkerConfig();

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
  const notifier = createNotifier(botEvents);
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
    case 'repos.add': {
      const ref = {
        provider: event.payload.response.provider,
        channelId: event.payload.response.channelId,
        ...(event.payload.response.threadId ? { threadId: event.payload.response.threadId } : {}),
      };
      try {
        const result = await addRepoCatalogEntryFromInput({
          repoKeyInput: event.payload.repoKey,
          sshUrl: event.payload.sshUrl,
          localPath: event.payload.localPath,
          projectId: event.payload.projectId,
          baseBranch: event.payload.baseBranch,
          provider: event.payload.repoProvider,
          ifMissing: event.payload.ifMissing,
          upsert: event.payload.upsert,
          allowlistPath: config.repoAllowlistPath,
        });
        const summary =
          result.result === 'updated'
            ? `Updated repository entry "${result.repoKey}".`
            : result.result === 'skipped'
              ? `Skipped: repository key "${result.repoKey}" already exists.`
              : `Added repository entry "${result.repoKey}".`;
        const syncText = result.syncedFile
          ? ` Synchronized allowlist file (${result.syncedFile.count ?? 0} entries).`
          : '';
        await notifier.postMessage(ref, `${summary}${syncText}`);
      } catch (err) {
        logger.error({ err, event }, 'Failed to add repository entry from worker event');
        await notifier.postMessage(
          ref,
          `Failed to add repository entry "${event.payload.repoKey}": ${(err as Error).message}`,
        );
      }
      return;
    }
    case 'repos.remove': {
      const ref = {
        provider: event.payload.response.provider,
        channelId: event.payload.response.channelId,
        ...(event.payload.response.threadId ? { threadId: event.payload.response.threadId } : {}),
      };
      try {
        const result = await removeRepoCatalogEntryFromInput({
          repoKeyInput: event.payload.repoKey,
          allowlistPath: config.repoAllowlistPath,
        });
        const syncText = result.syncedFile
          ? ` Synchronized allowlist file (${result.syncedFile.count ?? 0} entries).`
          : '';
        await notifier.postMessage(ref, `Removed repository entry "${result.repoKey}".${syncText}`);
      } catch (err) {
        logger.error({ err, event }, 'Failed to remove repository entry from worker event');
        await notifier.postMessage(
          ref,
          `Failed to remove repository entry "${event.payload.repoKey}": ${(err as Error).message}`,
        );
      }
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
    case 'agent.metadata.request': {
      try {
        await publishAgentMetadataUpdate(botEvents);
      } catch (err) {
        logger.error({ err, event }, 'Failed to publish agent metadata update');
      }
      return;
    }
    case 'agent.session.start': {
      void runAgentSessionStart({ event, config, notifier, botEvents }).catch((err) => {
        logger.error(
          { err, sessionId: event.payload.sessionId },
          'Background agent session prompt failed',
        );
      });
      return;
    }
    case 'agent.session.message': {
      void runAgentSessionMessage({ event, config, notifier, botEvents }).catch((err) => {
        logger.error(
          { err, sessionId: event.payload.sessionId },
          'Background agent session follow-up failed',
        );
      });
      return;
    }
    case 'agent.prompt.stop': {
      await stopAgentPrompt({ event, config, notifier, botEvents });
      return;
    }
    case 'agent.interaction.resolve': {
      await resolveAgentInteraction({ event, config, notifier, botEvents });
      return;
    }
    default:
      logger.warn({ event }, 'Unknown worker event received');
  }
}
