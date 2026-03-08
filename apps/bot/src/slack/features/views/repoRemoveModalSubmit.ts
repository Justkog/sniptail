import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { WORKER_EVENT_SCHEMA_VERSION, type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerRepoRemoveModalSubmit({
  app,
  slackIds,
  workerEventQueue,
  config,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.repoRemoveSubmit, async ({ ack, body, view, client }) => {
    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadId?: string;
        })
      : undefined;
    const repoKey = state.repo_key?.repo_key?.selected_option?.value?.trim() ?? '';

    const errors: Record<string, string> = {};
    if (!repoKey) {
      errors.repo_key = 'Repository key is required.';
    }

    if (!Object.keys(errors).length) {
      await refreshRepoAllowlist(config);
      if (!config.repoAllowlist[repoKey]) {
        errors.repo_key = `Repository key "${repoKey}" is not currently active.`;
      }
    }

    if (Object.keys(errors).length) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    await ack();

    const responseChannel = metadata?.channelId ?? body.user.id;
    const responseUser = metadata?.userId ?? body.user.id;
    const responseThreadId = metadata?.threadId;

    try {
      const event: WorkerEvent = {
        schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
        type: 'repos.remove',
        payload: {
          response: {
            provider: 'slack',
            channelId: responseChannel,
            userId: responseUser,
            ...(responseThreadId ? { threadId: responseThreadId } : {}),
            ...(body.team?.id ? { workspaceId: body.team.id } : {}),
          },
          repoKey,
        },
      };

      const authorized = await authorizeSlackOperationAndRespond({
        permissions,
        client: app.client,
        slackIds,
        action: 'repos.remove',
        summary: `Remove repo ${repoKey}`,
        operation: {
          kind: 'enqueueWorkerEvent',
          event,
        },
        actor: {
          userId: responseUser,
          channelId: responseChannel,
          ...(responseThreadId ? { threadId: responseThreadId } : {}),
          ...(body.team?.id ? { workspaceId: body.team.id } : {}),
        },
        onDeny: async () => {
          await postMessage(app, {
            channel: responseChannel,
            text: 'You are not authorized to remove repositories.',
            ...(responseThreadId ? { threadTs: responseThreadId } : {}),
          });
        },
      });
      if (!authorized) {
        return;
      }

      await enqueueWorkerEvent(workerEventQueue, event);

      await postMessage(app, {
        channel: responseChannel,
        text: `Queued repository removal for ${repoKey}. I'll post updates here shortly.`,
        ...(responseThreadId ? { threadTs: responseThreadId } : {}),
      });
    } catch (err) {
      logger.error({ err, repoKey }, 'Failed to queue repository removal');
      await client.chat.postEphemeral({
        channel: responseChannel,
        user: responseUser,
        text: `Failed to queue repository removal: ${(err as Error).message}`,
      });
    }
  });
}
