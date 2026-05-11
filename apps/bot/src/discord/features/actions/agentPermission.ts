import type { ButtonInteraction } from 'discord.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { DiscordAgentPermissionDecision } from '@sniptail/core/discord/components.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import {
  buildAgentInteractionResolveWorkerEvent,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';
import { getDiscordAgentPermissionMessageState } from '../../discordBotChannelAdapter.js';

function getMessageThreadId(message: ButtonInteraction['message']): string | undefined {
  const thread = message.thread;
  return typeof thread?.id === 'string' ? thread.id : undefined;
}

function isPermissionControlForSession(
  interaction: ButtonInteraction,
  session: NonNullable<Awaited<ReturnType<typeof loadAgentSession>>>,
): boolean {
  if (interaction.channel?.isThread() && interaction.channelId === session.threadId) {
    return true;
  }
  if (interaction.channelId !== session.channelId) {
    return false;
  }
  return getMessageThreadId(interaction.message) === session.threadId;
}

function decisionSummary(decision: DiscordAgentPermissionDecision): string {
  switch (decision) {
    case 'once':
      return 'Approve once';
    case 'always':
      return 'Always allow';
    case 'reject':
      return 'Reject';
  }
}

function appendDecisionText(
  content: string,
  userId: string,
  decision: DiscordAgentPermissionDecision,
): string {
  const base = content.trim() || 'Permission requested.';
  return `${base}\n\n${decisionSummary(decision)} selected by <@${userId}>.`;
}

export async function handleAgentPermissionButton(
  interaction: ButtonInteraction,
  input: {
    sessionId: string;
    interactionId: string;
    decision: DiscordAgentPermissionDecision;
  },
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<void> {
  const session = await loadAgentSession(input.sessionId);
  if (!session) {
    await interaction.reply({ content: 'Agent session not found.', ephemeral: true });
    return;
  }
  const threadId =
    interaction.channel?.isThread() && interaction.channelId
      ? interaction.channelId
      : getMessageThreadId(interaction.message);
  const validationError = threadId
    ? validateAgentSessionForThread({
        session,
        threadId,
        allowedStatuses: ['active'],
        wrongThreadMessage: 'This permission control does not belong to this agent session thread.',
      })
    : 'This permission control does not belong to this agent session thread.';
  if (validationError || !isPermissionControlForSession(interaction, session)) {
    await interaction.reply({
      content:
        validationError ?? 'This permission control does not belong to this agent session thread.',
      ephemeral: true,
    });
    return;
  }

  const event = buildAgentInteractionResolveWorkerEvent({
    session,
    actor: {
      userId: interaction.user.id,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    },
    interactionId: input.interactionId,
    resolution: {
      kind: 'permission',
      decision: input.decision,
    },
  });

  let denied = false;
  const messageState = getDiscordAgentPermissionMessageState(input.sessionId, input.interactionId);
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.interaction.resolve',
    summary: `${decisionSummary(input.decision)} OpenCode permission in session ${input.sessionId}`,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    actor: {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      threadId: interaction.channelId,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      denied = true;
      await interaction.reply({
        content: 'You are not authorized to resolve this agent permission request.',
        ephemeral: true,
      });
    },
  });
  if (!authorized) {
    if (!denied) {
      await interaction.update({
        content: appendDecisionText(
          messageState?.requestText ?? interaction.message.content,
          interaction.user.id,
          input.decision,
        ),
        components: [],
      });
    }
    return;
  }

  await enqueueWorkerEvent(workerEventQueue, event);
  await interaction.update({
    content: appendDecisionText(
      messageState?.requestText ?? interaction.message.content,
      interaction.user.id,
      input.decision,
    ),
    components: [],
  });
}
