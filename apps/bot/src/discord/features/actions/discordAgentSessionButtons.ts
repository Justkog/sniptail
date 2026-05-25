import { randomUUID } from 'node:crypto';
import type { ButtonInteraction } from 'discord.js';
import { createAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerMailboxEvent } from '@sniptail/core/queue/queue.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import { createJobId } from '../../../lib/jobs.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { loadAgentCommandMetadata } from '../../../agentCommandMetadataCache.js';
import {
  authorizeDiscordPrecheckAndRespond,
  authorizeDiscordOperationAndRespond,
} from '../../permissions/discordPermissionGuards.js';
import { isSendableTextChannel, postDiscordMessage } from '../../helpers.js';
import {
  buildDiscordAgentSessionsListWorkerEvent,
  findDiscordAgentSessionWorkerProfile,
  validateDiscordAgentSessionCwd,
  validateDiscordAgentSessionSelection,
} from '../../discordAgentSessionBrowserShared.js';
import {
  clearDiscordAgentSessionsActionState,
  getDiscordAgentSessionsActionState,
  setPendingDiscordAgentSessionBrowserRequest,
  type DiscordAgentSessionsAttachActionPayload,
  type DiscordAgentSessionsPageActionPayload,
} from '../../state.js';

const CUSTOM_ID_PREFIX = 'sniptail:agent-sessions';

export function buildDiscordAgentSessionsCustomId(
  action: 'previous' | 'next' | 'attach',
  token: string,
): string {
  return `${CUSTOM_ID_PREFIX}:${action}:${token}`;
}

export function parseDiscordAgentSessionsCustomId(customId: string):
  | {
      action: 'previous' | 'next' | 'attach';
      token: string;
    }
  | undefined {
  if (!customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) {
    return undefined;
  }
  const parts = customId.split(':');
  if (parts.length !== 4) {
    return undefined;
  }
  const action = parts[2];
  const token = parts[3]?.trim();
  if ((action !== 'previous' && action !== 'next' && action !== 'attach') || !token) {
    return undefined;
  }
  return { action, token };
}

function matchesInteractionRequester(
  payload: { channelId: string; userId: string; guildId?: string },
  interaction: ButtonInteraction,
): boolean {
  return (
    payload.channelId === interaction.channelId &&
    payload.userId === interaction.user.id &&
    payload.guildId === interaction.guildId
  );
}

function buildListSummary(payload: DiscordAgentSessionsPageActionPayload): string {
  return payload.agentProfileKey
    ? `Browse sessions for ${payload.agentProfileKey} on worker ${payload.workerId}`
    : `Browse sessions on worker ${payload.workerId}`;
}

async function enqueuePageRequest(input: {
  interaction: ButtonInteraction;
  config: BotConfig;
  queueRuntime: QueueTransportRuntime;
  permissions: PermissionsRuntimeService;
  payload: DiscordAgentSessionsPageActionPayload;
  cursor?: string;
  currentCursor?: string;
  cursorHistory: string[];
}) {
  const requestId = createJobId('agent-sessions');
  const event = buildDiscordAgentSessionsListWorkerEvent({
    requestId,
    channelId: input.payload.channelId,
    userId: input.payload.userId,
    ...(input.payload.guildId ? { guildId: input.payload.guildId } : {}),
    workerId: input.payload.workerId,
    ...(input.payload.agentProfileKey ? { agentProfileKey: input.payload.agentProfileKey } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.payload.filters ? { filters: input.payload.filters } : {}),
  });

  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions: input.permissions,
    botName: input.config.botName,
    action: 'agent.start',
    summary: buildListSummary(input.payload),
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
      targetWorkerId: input.payload.workerId,
    },
    actor: {
      userId: input.payload.userId,
      channelId: input.payload.channelId,
      ...(input.payload.guildId ? { guildId: input.payload.guildId } : {}),
      member: input.interaction.member,
    },
    client: input.interaction.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      denied = true;
      await input.interaction.editReply('You are not authorized to browse agent sessions.');
    },
  });
  if (!authorized) {
    if (!denied) {
      await input.interaction.editReply('Session browser request is pending approval.');
    }
    return;
  }

  setPendingDiscordAgentSessionBrowserRequest({
    requestId,
    channelId: input.payload.channelId,
    userId: input.payload.userId,
    ...(input.payload.guildId ? { guildId: input.payload.guildId } : {}),
    interactionApplicationId: input.interaction.applicationId,
    interactionToken: input.interaction.token,
    workerId: input.payload.workerId,
    ...(input.payload.agentProfileKey ? { agentProfileKey: input.payload.agentProfileKey } : {}),
    ...(input.payload.filters ? { filters: input.payload.filters } : {}),
    ...(input.currentCursor ? { currentCursor: input.currentCursor } : {}),
    cursorHistory: input.cursorHistory,
    requestedAt: Date.now(),
  });
  await enqueueWorkerMailboxEvent(input.queueRuntime, input.payload.workerId, event);
}

async function resolveAttachThread(
  interaction: ButtonInteraction,
  payload: DiscordAgentSessionsAttachActionPayload,
): Promise<{ channelId: string; threadId: string }> {
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !isSendableTextChannel(channel)) {
    throw new Error('This channel does not support threaded agent sessions.');
  }

  const text = [
    `Agent session attached by <@${payload.userId}>.`,
    `Provider: \`${payload.provider}\``,
    `Profile: \`${payload.sessionAgentProfileKey}\``,
    `Session ID: \`${payload.providerSessionId}\``,
    payload.title ? `Title: ${payload.title}` : undefined,
    '',
    'Reply in this thread to continue the attached session.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  if (channel.isThread()) {
    const parentChannelId = channel.parentId ?? interaction.channelId;
    await postDiscordMessage(interaction.client, {
      channelId: parentChannelId,
      threadId: channel.id,
      text,
    });
    return { channelId: parentChannelId, threadId: channel.id };
  }

  const seedMessage = await postDiscordMessage(interaction.client, {
    channelId: interaction.channelId,
    text,
  });
  const thread = await seedMessage.startThread({
    name: `attached agent ${payload.providerSessionId}`.slice(0, 100),
    autoArchiveDuration: 1440,
  });
  return { channelId: interaction.channelId, threadId: thread.id };
}

async function handlePageButton(
  interaction: ButtonInteraction,
  direction: 'previous' | 'next',
  token: string,
  payload: DiscordAgentSessionsPageActionPayload,
  config: BotConfig,
  queueRuntime: QueueTransportRuntime,
  permissions: PermissionsRuntimeService,
) {
  if (!matchesInteractionRequester(payload, interaction)) {
    await interaction.reply({
      content: 'This session browser action belongs to a different user.',
      ephemeral: true,
    });
    return;
  }
  clearDiscordAgentSessionsActionState(token);
  await interaction.update({
    content: 'Loading agent sessions...',
    components: [],
  });

  const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
    logger.error({ err }, 'Failed to refresh agent command metadata for Discord pagination');
    return undefined;
  });
  if (!metadata?.enabled) {
    await interaction.editReply('Agent sessions are not available yet. Please try again shortly.');
    return;
  }
  try {
    validateDiscordAgentSessionSelection({
      metadata,
      workerId: payload.workerId,
      ...(payload.agentProfileKey ? { agentProfileKey: payload.agentProfileKey } : {}),
      ...(payload.filters ? { filters: payload.filters } : {}),
    });
  } catch (err) {
    await interaction.editReply(`${(err as Error).message} Refresh the session list.`);
    return;
  }

  if (direction === 'next') {
    if (!payload.nextCursor) {
      await interaction.editReply('No later page is available.');
      return;
    }
    await enqueuePageRequest({
      interaction,
      config,
      queueRuntime,
      permissions,
      payload,
      cursor: payload.nextCursor,
      currentCursor: payload.nextCursor,
      cursorHistory: payload.currentCursor
        ? [...payload.cursorHistory, payload.currentCursor]
        : [...payload.cursorHistory],
    });
    return;
  }

  const previousCursor = payload.previousCursor ?? payload.cursorHistory.at(-1);
  await enqueuePageRequest({
    interaction,
    config,
    queueRuntime,
    permissions,
    payload,
    ...(previousCursor ? { cursor: previousCursor, currentCursor: previousCursor } : {}),
    cursorHistory: payload.cursorHistory.slice(0, -1),
  });
}

async function handleAttachButton(
  interaction: ButtonInteraction,
  token: string,
  payload: DiscordAgentSessionsAttachActionPayload,
  config: BotConfig,
  permissions: PermissionsRuntimeService,
) {
  if (!matchesInteractionRequester(payload, interaction)) {
    await interaction.reply({
      content: 'This session browser action belongs to a different user.',
      ephemeral: true,
    });
    return;
  }
  clearDiscordAgentSessionsActionState(token);

  const authorized = await authorizeDiscordPrecheckAndRespond({
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
        content: 'You are not authorized to attach agent sessions.',
        ephemeral: true,
      });
    },
  });
  if (!authorized) {
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
    logger.error({ err }, 'Failed to refresh agent command metadata for Discord attach');
    return undefined;
  });
  if (!metadata?.enabled) {
    await interaction.editReply('Agent sessions are not available yet. Please try again shortly.');
    return;
  }

  let worker;
  try {
    ({ worker } = validateDiscordAgentSessionSelection({
      metadata,
      workerId: payload.workerId,
      agentProfileKey: payload.sessionAgentProfileKey,
      ...(payload.filters ? { filters: payload.filters } : {}),
    }));
  } catch (err) {
    await interaction.editReply(`${(err as Error).message} Refresh the session list.`);
    return;
  }
  const profile = findDiscordAgentSessionWorkerProfile(worker, payload.sessionAgentProfileKey);
  if (!profile || profile.provider !== payload.provider) {
    await interaction.editReply(
      'The selected session profile is no longer available on that worker. Refresh the session list.',
    );
    return;
  }

  const workspaceKey =
    payload.workspaceKey ?? payload.filters?.workspaceKey ?? config.agentCommand?.defaultWorkspace;
  if (!workspaceKey) {
    await interaction.editReply('No workspace is available for the attached session.');
    return;
  }
  let cwd: string | undefined;
  try {
    cwd = validateDiscordAgentSessionCwd(payload.cwd ?? payload.filters?.cwd);
  } catch (err) {
    await interaction.editReply((err as Error).message);
    return;
  }

  let thread;
  try {
    thread = await resolveAttachThread(interaction, payload);
  } catch (err) {
    logger.error({ err }, 'Failed to create or resolve Discord attach thread');
    await interaction.editReply('Failed to create a thread for the attached session.');
    return;
  }

  const now = new Date();
  const sessionId = randomUUID();
  try {
    await createAgentSession({
      sessionId,
      provider: 'discord',
      channelId: thread.channelId,
      threadId: thread.threadId,
      userId: interaction.user.id,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      workspaceKey,
      agentProfileKey: payload.sessionAgentProfileKey,
      ...(cwd ? { cwd } : {}),
      ownerWorkerId: payload.workerId,
      ...(worker.workerLabel ? { ownerWorkerLabel: worker.workerLabel } : {}),
      workerClaimedAt: now.toISOString(),
      codingAgentSessionId: payload.providerSessionId,
      status: 'completed',
      now,
    });
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to create Discord attached session record');
    await interaction.editReply(`Failed to create the session record: ${(err as Error).message}`);
    return;
  }

  await interaction.editReply(
    `Attached provider session in <#${thread.threadId}> on worker \`${payload.workerId}\`.`,
  );
}

export async function handleDiscordAgentSessionsButton(
  interaction: ButtonInteraction,
  parsed: { action: 'previous' | 'next' | 'attach'; token: string },
  config: BotConfig,
  queueRuntime: QueueTransportRuntime,
  permissions: PermissionsRuntimeService,
) {
  const state = getDiscordAgentSessionsActionState(parsed.token);
  if (!state || state.kind !== parsed.action) {
    await interaction.reply({
      content: 'This session browser action expired. Refresh the session list.',
      ephemeral: true,
    });
    return;
  }

  if (state.kind === 'attach') {
    await handleAttachButton(interaction, parsed.token, state.payload, config, permissions);
    return;
  }
  await handlePageButton(
    interaction,
    state.kind,
    parsed.token,
    state.payload,
    config,
    queueRuntime,
    permissions,
  );
}
