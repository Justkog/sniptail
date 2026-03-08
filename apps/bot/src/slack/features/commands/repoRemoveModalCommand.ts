import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { refreshRepoAllowlist } from '../../../lib/repoAllowlist.js';
import { buildRepoRemoveAdminModal } from '../../modals.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerRepoRemoveModalCommand({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.repoRemove, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:repo-remove`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'repos.remove',
      actor: {
        userId: body.user_id,
        channelId: body.channel_id,
        ...(body.thread_ts ? { threadId: body.thread_ts as string } : {}),
        workspaceId: body.team_id,
      },
      onDeny: async () => {
        await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: 'You are not authorized to remove repositories.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    await refreshRepoAllowlist(config);
    const repoKeys = Object.keys(config.repoAllowlist);
    if (!repoKeys.length) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: 'No repositories are currently registered.',
      });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildRepoRemoveAdminModal(
        config.repoAllowlist,
        config.botName,
        slackIds.actions.repoRemoveSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          ...(body.thread_ts ? { threadId: body.thread_ts as string } : {}),
        }),
      ),
    });
  });
}
