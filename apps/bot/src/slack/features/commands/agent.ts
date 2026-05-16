import { isAbsolute } from 'node:path';
import { loadSlackAgentDefaults } from '@sniptail/core/agent-defaults/registry.js';
import { dedupe } from '../../lib/dedupe.js';
import { buildAgentModal } from '../../modals.js';
import { buildAgentWorkerChoices } from '../../../agentCommandWorkerRouting.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackPrecheckAndRespond } from '../../permissions/slackPermissionGuards.js';
import {
  listSelectableAgentProfiles,
  loadAgentCommandMetadata,
} from '../../../agentCommandMetadataCache.js';

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validateRelativeCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (isAbsolute(cwd)) {
    throw new Error('`cwd` must be a relative path.');
  }
  return cwd;
}

export function registerAgentCommand({ app, slackIds, config, permissions }: SlackHandlerContext) {
  app.command(slackIds.commands.agent, async ({ ack, body, client }) => {
    await ack();
    const dedupeKey = `${body.team_id}:${body.trigger_id}:agent`;
    if (dedupe(dedupeKey)) {
      return;
    }

    const metadata = await loadAgentCommandMetadata().catch(() => undefined);
    if (!metadata?.enabled) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: 'Agent sessions are not available yet. Please try again in a few seconds.',
      });
      return;
    }

    const authorized = await authorizeSlackPrecheckAndRespond({
      permissions,
      client,
      action: 'agent.start',
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
          text: 'You are not authorized to start agent sessions.',
        });
      },
    });
    if (!authorized) {
      return;
    }

    const defaults = await loadSlackAgentDefaults({
      userId: body.user_id,
      workspaceId: body.team_id,
    }).catch(() => undefined);
    const selectableProfiles = listSelectableAgentProfiles(metadata);
    if (!metadata.workspaces.length || !selectableProfiles.length) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: 'No non-conflicted agent profiles are available right now. Please try again later.',
      });
      return;
    }
    const selectedWorkspaceKey =
      defaults?.workspaceKey &&
      metadata.workspaces.some((workspace) => workspace.key === defaults.workspaceKey)
        ? defaults.workspaceKey
        : config.agentCommand?.defaultWorkspace;
    const selectedProfileKey =
      defaults?.agentProfileKey &&
      selectableProfiles.some((profile) => profile.key === defaults.agentProfileKey)
        ? defaults.agentProfileKey
        : config.agentCommand?.defaultAgentProfile;
    const initialCwd = validateRelativeCwd(normalizeOptionalString(defaults?.cwd));
    const workerChoices = buildAgentWorkerChoices(
      metadata,
      selectedWorkspaceKey,
      selectedProfileKey,
    ).map((choice) => ({
      key: choice.value,
      label: choice.name,
      value: choice.value,
    }));

    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildAgentModal(
        config.botName,
        slackIds.actions.agentSubmit,
        JSON.stringify({
          channelId: body.channel_id,
          userId: body.user_id,
          threadId: (body.thread_ts as string) ?? undefined,
          workspaceId: body.team_id,
        }),
        {
          workspaces: metadata.workspaces,
          profiles: selectableProfiles,
          ...(workerChoices.length ? { workers: workerChoices } : {}),
          ...(selectedWorkspaceKey ? { selectedWorkspaceKey } : {}),
          ...(selectedProfileKey ? { selectedProfileKey } : {}),
          ...(initialCwd ? { initialCwd } : {}),
        },
      ),
    });
  });
}
