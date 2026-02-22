import { loadJobRecord } from '@sniptail/core/jobs/registry.js';
import { logger } from '@sniptail/core/logger.js';
import type { SlackHandlerContext } from '../context.js';
import { buildRunModal } from '../../modals.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerRunFromJobAction({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.action(slackIds.actions.runFromJob, async ({ ack, body, client, action }) => {
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
      action: 'jobs.run',
      actor: {
        userId,
        channelId,
        ...(threadId ? { threadId } : {}),
      },
      onDeny: async () => {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: 'You are not authorized to run custom actions.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    await refreshRepoAllowlist(config);
    if (!Object.keys(config.run?.actions ?? {}).length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'No run actions are configured for this bot.',
      });
      return;
    }

    const record = await loadJobRecord(jobId).catch((err) => {
      logger.warn({ err, jobId }, 'Failed to load job record for run from job');
      return undefined;
    });
    const repoKeys = record?.job?.repoKeys ?? [];
    if (!repoKeys.length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Unable to open run modal for job ${jobId}.`,
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
      view: buildRunModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.runSubmit,
        JSON.stringify({
          channelId,
          userId,
          threadId: threadId ?? undefined,
        }),
        slackIds.actions.runActionSelect,
        repoKeys,
      ),
    });
  });
}
