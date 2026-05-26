import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerMailboxEvent } from '@sniptail/core/queue/queue.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import { createJobId } from '../../../lib/jobs.js';
import {
  buildCwdAutocompleteChoices,
  buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices,
  loadAgentCommandMetadata,
} from '../../../agentCommandMetadataCache.js';
import { buildAgentWorkerChoices } from '../../../agentCommandWorkerRouting.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import {
  buildDiscordAgentSessionsListWorkerEvent,
  normalizeDiscordAgentSessionFilters,
  validateDiscordAgentSessionCwd,
  validateDiscordAgentSessionSelection,
} from '../../discordAgentSessionBrowserShared.js';
import {
  clearPendingDiscordAgentSessionBrowserRequest,
  setPendingDiscordAgentSessionBrowserRequest,
} from '../../state.js';

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function filterWorkerAutocompleteChoices(
  choices: Array<{ name: string; value: string }>,
  rawQuery: string,
) {
  const query = rawQuery.trim().toLowerCase();
  return choices
    .filter(
      (choice) =>
        !query ||
        choice.name.toLowerCase().includes(query) ||
        choice.value.toLowerCase().includes(query),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 25);
}

function resolveCommandFilters(interaction: ChatInputCommandInteraction) {
  const workspaceKey = normalizeOptionalString(interaction.options.getString('workspace'));
  const cwd = validateDiscordAgentSessionCwd(
    normalizeOptionalString(interaction.options.getString('cwd')),
  );
  if (!workspaceKey && cwd) {
    throw new Error('A workspace selector is required when cwd is provided.');
  }

  return normalizeDiscordAgentSessionFilters({
    ...(workspaceKey ? { workspaceKey } : {}),
    ...(cwd ? { cwd } : {}),
  });
}

export async function handleDiscordAgentSessionsAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'workspace') {
    await interaction.respond(await buildWorkspaceAutocompleteChoices(String(focused.value ?? '')));
    return;
  }
  if (focused.name === 'agent_profile') {
    await interaction.respond(await buildProfileAutocompleteChoices(String(focused.value ?? '')));
    return;
  }
  if (focused.name === 'cwd') {
    await interaction.respond(buildCwdAutocompleteChoices(String(focused.value ?? '')));
    return;
  }
  if (focused.name === 'worker') {
    const metadata = await loadAgentCommandMetadata();
    const selectedWorkspace = normalizeOptionalString(interaction.options.getString('workspace'));
    const selectedProfile = normalizeOptionalString(interaction.options.getString('agent_profile'));
    await interaction.respond(
      metadata.enabled
        ? filterWorkerAutocompleteChoices(
            buildAgentWorkerChoices(metadata, selectedWorkspace, selectedProfile),
            String(focused.value ?? ''),
          )
        : [],
    );
    return;
  }
  await interaction.respond([]);
}

export async function handleDiscordAgentSessionsCommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  queueRuntime: QueueTransportRuntime,
  permissions: PermissionsRuntimeService,
) {
  const workerId = normalizeOptionalString(interaction.options.getString('worker'));
  if (!workerId) {
    await interaction.reply({
      content: 'A worker selector is required.',
      ephemeral: true,
    });
    return;
  }

  let filters;
  try {
    filters = resolveCommandFilters(interaction);
  } catch (err) {
    await interaction.reply({
      content: (err as Error).message,
      ephemeral: true,
    });
    return;
  }

  const agentProfileKey = normalizeOptionalString(interaction.options.getString('agent_profile'));
  const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
    logger.error({ err }, 'Failed to load agent command metadata for Discord session browser');
    return undefined;
  });
  if (!metadata?.enabled) {
    await interaction.reply({
      content: 'Agent sessions are not available yet. Please try again in a few seconds.',
      ephemeral: true,
    });
    return;
  }

  try {
    validateDiscordAgentSessionSelection({
      metadata,
      workerId,
      ...(agentProfileKey ? { agentProfileKey } : {}),
      ...(filters ? { filters } : {}),
    });
  } catch (err) {
    await interaction.reply({
      content: (err as Error).message,
      ephemeral: true,
    });
    return;
  }

  const requestId = createJobId('agent-sessions');
  const event = buildDiscordAgentSessionsListWorkerEvent({
    requestId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    workerId,
    ...(agentProfileKey ? { agentProfileKey } : {}),
    ...(filters ? { filters } : {}),
  });

  await interaction.deferReply({ ephemeral: true });

  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.start',
    summary: agentProfileKey
      ? `Browse sessions for ${agentProfileKey} on worker ${workerId}`
      : `Browse sessions on worker ${workerId}`,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
      targetWorkerId: workerId,
    },
    actor: {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      ...(interaction.channel?.isThread() ? { threadId: interaction.channelId } : {}),
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    onDeny: async () => {
      denied = true;
      await interaction.editReply('You are not authorized to browse agent sessions.');
    },
    onRequireApprovalNotice: async (message) => {
      await interaction.editReply(message);
    },
    approvalPresentation: 'approval_only',
  });
  if (!authorized) {
    if (!denied) {
      await interaction.editReply('Session browser request is pending approval.');
    }
    return;
  }

  await interaction.editReply('Loading agent sessions...');
  setPendingDiscordAgentSessionBrowserRequest({
    requestId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    interactionApplicationId: interaction.applicationId,
    interactionToken: interaction.token,
    workerId,
    ...(agentProfileKey ? { agentProfileKey } : {}),
    ...(filters ? { filters } : {}),
    cursorHistory: [],
    requestedAt: Date.now(),
  });

  try {
    await enqueueWorkerMailboxEvent(queueRuntime, workerId, event);
  } catch (err) {
    clearPendingDiscordAgentSessionBrowserRequest(requestId);
    logger.error({ err, requestId, workerId }, 'Failed to enqueue Discord agent sessions list');
    await interaction.editReply('Failed to request the session list. Please try again shortly.');
  }
}
