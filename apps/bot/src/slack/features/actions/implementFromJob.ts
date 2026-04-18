import type { SlackHandlerContext } from '../context.js';
import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { buildImplementModal } from '../../modals.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerImplementFromJobAction({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.action(slackIds.actions.implementFromJob, async ({ ack, body, client, action }) => {
    await ack();
    const jobId = (action as { value?: string }).value?.trim();
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;

    if (!jobId || !triggerId || !channelId || !userId) {
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'jobs.implement',
      actor: {
        userId,
        channelId,
        ...(threadId ? { threadId } : {}),
      },
      onDeny: async () => {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: 'You are not authorized to run implement jobs.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    await refreshRepoAllowlist(config);
    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record for implement from job');
      return undefined;
    });
    const repoKeys = record?.job?.repoKeys ?? [];
    if (!repoKeys.length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Unable to open implement modal for job ${jobId}.`,
      });
      return;
    }

    const unknownRepos = repoKeys.filter((key) => !config.repoAllowlist[key]);
    if (unknownRepos.length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Unknown repo keys: ${unknownRepos.join(', ')}. Update the allowlist and try again.`,
      });
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: buildImplementModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.implementSubmit,
        JSON.stringify({
          channelId,
          userId,
          threadId: threadId ?? undefined,
        }),
        jobId,
        repoKeys,
      ),
    });
  });
}
