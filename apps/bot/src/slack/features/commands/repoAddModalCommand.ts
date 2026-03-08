import type { SlackHandlerContext } from '../context.js';
import { dedupe } from '../../lib/dedupe.js';
import { buildRepoAddAdminModal } from '../../modals.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerRepoAddModalCommand({
  app,
  slackIds,
  config,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.repoAdd, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:repo-add`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'repos.add',
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
          text: 'You are not authorized to add repositories.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildRepoAddAdminModal(
        config.botName,
        slackIds.actions.repoAddSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          ...(body.thread_ts ? { threadId: body.thread_ts as string } : {}),
        }),
        process.env.LOCAL_REPO_ROOT?.trim(),
      ),
    });
  });
}
