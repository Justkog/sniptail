import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { logger } from '@sniptail/core/logger.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import {
  authorizeDiscordOperationAndRespond,
  authorizeDiscordPrecheckAndRespond,
} from '../../permissions/discordPermissionGuards.js';
import {
  buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices,
  getDiscordAgentCommandMetadata,
} from '../../agentCommandMetadataCache.js';
import { isSendableTextChannel, postDiscordMessage } from '../../helpers.js';
import { truncateRequestSummary } from '../../../lib/jobs.js';

type ResolvedAgentThread = {
  channelId: string;
  threadId: string;
};

function normalizeOptionalString(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildAgentThreadName(botName: string, sessionId: string): string {
  return `${botName} agent ${sessionId}`.slice(0, 100);
}

async function resolveAgentThread(
  interaction: ChatInputCommandInteraction,
): Promise<ResolvedAgentThread> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !isSendableTextChannel(channel)) {
    throw new Error('This channel does not support threaded agent sessions.');
  }

  if (channel.isThread()) {
    const parentChannelId = channel.parentId ?? interaction.channelId;
    return {
      channelId: parentChannelId,
      threadId: channel.id,
    };
  }

  const seedMessage = await postDiscordMessage(interaction.client, {
    channelId: interaction.channelId,
    text: `Agent session requested by <@${interaction.user.id}>.`,
  });
  const thread = await seedMessage.startThread({
    name: buildAgentThreadName(interaction.client.user?.username ?? 'sniptail', seedMessage.id),
    autoArchiveDuration: 1440,
  });
  return {
    channelId: interaction.channelId,
    threadId: thread.id,
  };
}

function validateRelativeCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (isAbsolute(cwd)) {
    throw new Error('`cwd` must be a relative path.');
  }
  return cwd;
}

function hasWorkspaceKey(
  metadata: NonNullable<ReturnType<typeof getDiscordAgentCommandMetadata>>,
  key: string,
): boolean {
  return metadata.workspaces.some((workspace) => workspace.key === key);
}

function hasProfileKey(
  metadata: NonNullable<ReturnType<typeof getDiscordAgentCommandMetadata>>,
  key: string,
): boolean {
  return metadata.profiles.some((profile) => profile.key === key);
}

export async function handleAgentAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'workspace') {
    await interaction.respond(buildWorkspaceAutocompleteChoices(String(focused.value ?? '')));
    return;
  }
  if (focused.name === 'agent_profile') {
    await interaction.respond(buildProfileAutocompleteChoices(String(focused.value ?? '')));
    return;
  }
  await interaction.respond([]);
}

export async function handleAgentStart(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
) {
  const metadata = getDiscordAgentCommandMetadata();
  if (!metadata || !metadata.enabled) {
    await interaction.reply({
      content: 'Agent sessions are not available yet. Please try again in a few seconds.',
      ephemeral: true,
    });
    return;
  }

  const prompt = interaction.options.getString('prompt', true).trim();
  if (!prompt) {
    await interaction.reply({
      content: 'The prompt cannot be empty.',
      ephemeral: true,
    });
    return;
  }

  const explicitWorkspace = normalizeOptionalString(interaction.options.getString('workspace'));
  const explicitProfile = normalizeOptionalString(interaction.options.getString('agent_profile'));
  const cwd = validateRelativeCwd(normalizeOptionalString(interaction.options.getString('cwd')));

  const workspaceKey = explicitWorkspace ?? metadata.defaultWorkspace;
  if (!workspaceKey) {
    await interaction.reply({
      content: 'No workspace was provided and no default workspace is configured.',
      ephemeral: true,
    });
    return;
  }
  if (!hasWorkspaceKey(metadata, workspaceKey)) {
    await interaction.reply({
      content: `Unknown workspace key: \`${workspaceKey}\`.`,
      ephemeral: true,
    });
    return;
  }

  const profileKey = explicitProfile ?? metadata.defaultAgentProfile;
  if (!profileKey) {
    await interaction.reply({
      content: 'No agent profile was provided and no default profile is configured.',
      ephemeral: true,
    });
    return;
  }
  if (!hasProfileKey(metadata, profileKey)) {
    await interaction.reply({
      content: `Unknown agent profile key: \`${profileKey}\`.`,
      ephemeral: true,
    });
    return;
  }

  const authorizedPrecheck = await authorizeDiscordPrecheckAndRespond({
    permissions,
    action: 'agent.start',
    actor: {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      ...(interaction.channel?.isThread() ? { threadId: interaction.channelId } : {}),
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    onDeny: async () => {
      await interaction.reply({
        content: 'You are not authorized to start agent sessions.',
        ephemeral: true,
      });
    },
  });
  if (!authorizedPrecheck) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let thread: ResolvedAgentThread;
  try {
    thread = await resolveAgentThread(interaction);
  } catch (err) {
    logger.error({ err }, 'Failed to create or resolve Discord thread for /agent');
    await interaction.editReply('Failed to create a thread for this agent session.');
    return;
  }

  const sessionId = randomUUID();
  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.session.start',
    payload: {
      sessionId,
      response: {
        provider: 'discord',
        channelId: thread.threadId,
        threadId: thread.threadId,
        userId: interaction.user.id,
        workspaceId: workspaceKey,
        ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      },
      prompt,
      workspaceKey,
      agentProfileKey: profileKey,
      ...(cwd ? { cwd } : {}),
    },
  };

  const summary = [
    `Start agent session in workspace ${workspaceKey}`,
    `profile ${profileKey}`,
    cwd ? `cwd ${cwd}` : undefined,
    `prompt "${truncateRequestSummary(prompt)}"`,
  ]
    .filter(Boolean)
    .join(' | ');

  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.start',
    summary,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    actor: {
      userId: interaction.user.id,
      channelId: thread.threadId,
      threadId: thread.threadId,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      denied = true;
      await interaction.editReply('You are not authorized to start agent sessions.');
    },
  });
  if (!authorized) {
    if (!denied) {
      await interaction.editReply(`Session request is pending approval in <#${thread.threadId}>.`);
    }
    return;
  }

  try {
    await enqueueWorkerEvent(workerEventQueue, event);
    await postDiscordMessage(interaction.client, {
      channelId: thread.channelId,
      threadId: thread.threadId,
      text: `Session starting.\nWorkspace: \`${workspaceKey}\`\nProfile: \`${profileKey}\`${cwd ? `\nCWD: \`${cwd}\`` : ''}`,
    });
    await interaction.editReply(`Agent session started in <#${thread.threadId}>.`);
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to enqueue agent session start event');
    await interaction.editReply(`Failed to start the session: ${(err as Error).message}`);
  }
}
