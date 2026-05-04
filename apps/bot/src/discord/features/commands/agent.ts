import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import {
  loadDiscordAgentDefaults,
  upsertDiscordAgentDefaults,
} from '@sniptail/core/agent-defaults/registry.js';
import {
  createAgentSession,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { logger } from '@sniptail/core/logger.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import { buildDiscordAgentStopComponents } from '@sniptail/core/discord/components.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import {
  authorizeDiscordOperationAndRespond,
  authorizeDiscordPrecheckAndRespond,
} from '../../permissions/discordPermissionGuards.js';
import {
  buildCwdAutocompleteChoices,
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

type AgentControlMessageInput = {
  sessionId: string;
  prompt: string;
  workspaceKey: string;
  agentProfileKey: string;
  cwd?: string;
};

function normalizeOptionalString(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildAgentThreadName(botName: string, sessionId: string): string {
  return `${botName} agent ${sessionId}`.slice(0, 100);
}

function buildAgentControlText(
  userId: string,
  { prompt, workspaceKey, agentProfileKey, cwd }: AgentControlMessageInput,
): string {
  return [
    `Agent session requested by <@${userId}>.`,
    '',
    '```',
    truncateRequestSummary(prompt),
    '```',
    `Workspace: \`${workspaceKey}\``,
    `Profile: \`${agentProfileKey}\``,
    cwd ? `CWD: \`${cwd}\`` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function resolveAgentThread(
  interaction: ChatInputCommandInteraction,
  controlMessage: AgentControlMessageInput,
): Promise<ResolvedAgentThread> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !isSendableTextChannel(channel)) {
    throw new Error('This channel does not support threaded agent sessions.');
  }

  if (channel.isThread()) {
    const parentChannelId = channel.parentId ?? interaction.channelId;
    await postDiscordMessage(interaction.client, {
      channelId: parentChannelId,
      threadId: channel.id,
      text: buildAgentControlText(interaction.user.id, controlMessage),
      components: buildDiscordAgentStopComponents(controlMessage.sessionId),
    });
    return {
      channelId: parentChannelId,
      threadId: channel.id,
    };
  }

  const seedMessage = await postDiscordMessage(interaction.client, {
    channelId: interaction.channelId,
    text: buildAgentControlText(interaction.user.id, controlMessage),
    components: buildDiscordAgentStopComponents(controlMessage.sessionId),
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

type ResolvedAgentSelections = {
  workspaceKey: string;
  profileKey: string;
  cwd?: string;
};

function resolveKnownWorkspaceKey(
  metadata: NonNullable<ReturnType<typeof getDiscordAgentCommandMetadata>>,
  workspaceKey: string | undefined,
): string | undefined {
  if (!workspaceKey) return undefined;
  return hasWorkspaceKey(metadata, workspaceKey) ? workspaceKey : undefined;
}

function resolveKnownProfileKey(
  metadata: NonNullable<ReturnType<typeof getDiscordAgentCommandMetadata>>,
  profileKey: string | undefined,
): string | undefined {
  if (!profileKey) return undefined;
  return hasProfileKey(metadata, profileKey) ? profileKey : undefined;
}

async function resolveAgentSelections(
  interaction: Pick<ChatInputCommandInteraction, 'options' | 'user' | 'guildId'>,
  metadata: NonNullable<ReturnType<typeof getDiscordAgentCommandMetadata>>,
): Promise<ResolvedAgentSelections | { error: string }> {
  const persistedDefaults = await loadDiscordAgentDefaults({
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
  }).catch((err) => {
    logger.warn({ err, userId: interaction.user.id }, 'Failed to load Discord agent defaults');
    return undefined;
  });

  const explicitWorkspace = normalizeOptionalString(interaction.options.getString('workspace'));
  const explicitProfile = normalizeOptionalString(interaction.options.getString('agent_profile'));
  const explicitCwd = validateRelativeCwd(
    normalizeOptionalString(interaction.options.getString('cwd')),
  );

  if (explicitWorkspace && !resolveKnownWorkspaceKey(metadata, explicitWorkspace)) {
    return { error: `Unknown workspace key: \`${explicitWorkspace}\`.` };
  }
  if (explicitProfile && !resolveKnownProfileKey(metadata, explicitProfile)) {
    return { error: `Unknown agent profile key: \`${explicitProfile}\`.` };
  }

  const workspaceKey =
    explicitWorkspace ??
    resolveKnownWorkspaceKey(metadata, persistedDefaults?.workspaceKey) ??
    resolveKnownWorkspaceKey(metadata, metadata.defaultWorkspace);
  if (!workspaceKey) {
    return { error: 'No workspace was provided and no valid default workspace is configured.' };
  }

  const profileKey =
    explicitProfile ??
    resolveKnownProfileKey(metadata, persistedDefaults?.agentProfileKey) ??
    resolveKnownProfileKey(metadata, metadata.defaultAgentProfile);
  if (!profileKey) {
    return { error: 'No agent profile was provided and no valid default profile is configured.' };
  }

  const fallbackCwd =
    !explicitCwd && persistedDefaults?.workspaceKey === workspaceKey
      ? persistedDefaults.cwd
      : undefined;
  const cwd = explicitCwd ?? fallbackCwd;

  return {
    workspaceKey,
    profileKey,
    ...(cwd ? { cwd } : {}),
  };
}

export async function handleAgentAutocomplete(interaction: AutocompleteInteraction) {
  const persistedDefaults = await loadDiscordAgentDefaults({
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
  }).catch((err) => {
    logger.warn({ err, userId: interaction.user.id }, 'Failed to load Discord agent defaults');
    return undefined;
  });
  const focused = interaction.options.getFocused(true);
  const selectedWorkspace = normalizeOptionalString(interaction.options.getString('workspace'));
  if (focused.name === 'workspace') {
    await interaction.respond(
      buildWorkspaceAutocompleteChoices(
        String(focused.value ?? ''),
        persistedDefaults?.workspaceKey,
      ),
    );
    return;
  }
  if (focused.name === 'agent_profile') {
    await interaction.respond(
      buildProfileAutocompleteChoices(
        String(focused.value ?? ''),
        persistedDefaults?.agentProfileKey,
      ),
    );
    return;
  }
  if (focused.name === 'cwd') {
    await interaction.respond(
      buildCwdAutocompleteChoices(
        String(focused.value ?? ''),
        selectedWorkspace && selectedWorkspace !== persistedDefaults?.workspaceKey
          ? undefined
          : persistedDefaults?.cwd,
      ),
    );
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

  let resolvedSelections: ResolvedAgentSelections | { error: string };
  try {
    resolvedSelections = await resolveAgentSelections(interaction, metadata);
  } catch (err) {
    await interaction.reply({
      content: `Failed to resolve agent defaults: ${(err as Error).message}`,
      ephemeral: true,
    });
    return;
  }
  if ('error' in resolvedSelections) {
    await interaction.reply({
      content: resolvedSelections.error,
      ephemeral: true,
    });
    return;
  }
  const { workspaceKey, profileKey, cwd } = resolvedSelections;

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

  const sessionId = randomUUID();
  let thread: ResolvedAgentThread;
  try {
    thread = await resolveAgentThread(interaction, {
      sessionId,
      prompt,
      workspaceKey,
      agentProfileKey: profileKey,
      ...(cwd ? { cwd } : {}),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create or resolve Discord thread for /agent');
    await interaction.editReply('Failed to create a thread for this agent session.');
    return;
  }

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

  try {
    await createAgentSession({
      sessionId,
      provider: 'discord',
      channelId: thread.channelId,
      threadId: thread.threadId,
      userId: interaction.user.id,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      workspaceKey,
      agentProfileKey: profileKey,
      ...(cwd ? { cwd } : {}),
      status: 'pending',
    });
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to create Discord agent session record');
    await interaction.editReply(`Failed to create the session record: ${(err as Error).message}`);
    return;
  }

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
      await updateAgentSessionStatus(sessionId, 'failed').catch((err) => {
        logger.warn({ err, sessionId }, 'Failed to mark denied agent session as failed');
      });
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
    await upsertDiscordAgentDefaults({
      userId: interaction.user.id,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      workspaceKey,
      agentProfileKey: profileKey,
      ...(cwd ? { cwd } : {}),
    }).catch((err) => {
      logger.warn(
        { err, sessionId, userId: interaction.user.id },
        'Failed to persist Discord agent defaults',
      );
    });
    await updateAgentSessionStatus(sessionId, 'active');
    await interaction.editReply(`Agent session started in <#${thread.threadId}>.`);
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to enqueue agent session start event');
    await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
      logger.warn({ err: updateErr, sessionId }, 'Failed to mark agent session as failed');
    });
    await interaction.editReply(`Failed to start the session: ${(err as Error).message}`);
  }
}
