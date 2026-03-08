import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { WORKER_EVENT_SCHEMA_VERSION, type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { SlackHandlerContext } from '../context.js';
import { postMessage } from '../../helpers.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

function parseOptionalProjectId(value?: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    return Number.NaN;
  }
  return Number.parseInt(trimmed, 10);
}

export function registerRepoAddModalSubmit({
  app,
  slackIds,
  workerEventQueue,
  config,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.repoAddSubmit, async ({ ack, body, view, client }) => {
    const state = view.state.values;
    const metadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadId?: string;
        })
      : undefined;
    const repoKey = state.repo_key?.repo_key?.value?.trim() ?? '';
    const repoProvider = state.provider?.provider?.selected_option?.value?.trim() ?? '';
    const sshUrl = state.ssh_url?.ssh_url?.value?.trim() ?? '';
    const localPath = state.local_path?.local_path?.value?.trim() ?? '';
    const projectIdRaw = state.project_id?.project_id?.value?.trim() ?? '';
    const projectId = parseOptionalProjectId(projectIdRaw);
    const baseBranch = state.base_branch?.base_branch?.value?.trim() ?? '';

    const errors: Record<string, string> = {};
    if (!repoKey) {
      errors.repo_key = 'Repository key is required.';
    }
    if (!repoProvider) {
      errors.provider = 'Repository provider is required.';
    }
    if (repoProvider === 'local' && !localPath) {
      errors.local_path = 'Local path is required for local repositories.';
    }
    if (repoProvider !== 'local' && !sshUrl) {
      errors.ssh_url = 'SSH URL is required for remote repositories.';
    }
    if (sshUrl && localPath) {
      errors.ssh_url = 'SSH URL and local path cannot both be set.';
      errors.local_path = 'SSH URL and local path cannot both be set.';
    }
    if (repoProvider === 'gitlab' && projectId === undefined) {
      errors.project_id = 'GitLab project ID is required for GitLab repositories.';
    }
    if (projectIdRaw && Number.isNaN(projectId)) {
      errors.project_id = 'GitLab project ID must be a positive integer.';
    }

    if (!Object.keys(errors).length) {
      await refreshRepoAllowlist(config);
      if (config.repoAllowlist[repoKey]) {
        errors.repo_key = `Repository key "${repoKey}" already exists.`;
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
        type: 'repos.add',
        payload: {
          response: {
            provider: 'slack',
            channelId: responseChannel,
            userId: responseUser,
            ...(responseThreadId ? { threadId: responseThreadId } : {}),
            ...(body.team?.id ? { workspaceId: body.team.id } : {}),
          },
          repoKey,
          repoProvider,
          ...(sshUrl ? { sshUrl } : {}),
          ...(localPath ? { localPath } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(baseBranch ? { baseBranch } : {}),
        },
      };

      const authorized = await authorizeSlackOperationAndRespond({
        permissions,
        client: app.client,
        slackIds,
        action: 'repos.add',
        summary: `Add repo ${repoKey} (provider: ${repoProvider})`,
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
            text: 'You are not authorized to add repositories.',
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
        text: `Queued repository add for ${repoKey}. I'll post updates here shortly.`,
        ...(responseThreadId ? { threadTs: responseThreadId } : {}),
      });
    } catch (err) {
      logger.error({ err, repoKey, repoProvider }, 'Failed to queue repository add');
      await client.chat.postEphemeral({
        channel: responseChannel,
        user: responseUser,
        text: `Failed to queue repository add: ${(err as Error).message}`,
      });
    }
  });
}
