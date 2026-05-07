import type { ButtonInteraction } from 'discord.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import {
  buildAgentPromptStopWorkerEvent,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';

function appendStopRequestedText(content: string, userId: string): string {
  const base = content.trim() || 'Agent session.';
  return `${base}\n\nStop request sent by <@${userId}>.`;
}

function getMessageThreadId(message: ButtonInteraction['message']): string | undefined {
  const thread = message.thread;
  return typeof thread?.id === 'string' ? thread.id : undefined;
}

function isStopControlForSession(
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

export async function handleAgentStopButton(
  interaction: ButtonInteraction,
  sessionId: string,
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<void> {
  const session = await loadAgentSession(sessionId);
  const threadId =
    interaction.channel?.isThread() && interaction.channelId
      ? interaction.channelId
      : getMessageThreadId(interaction.message);
  const validationError = threadId
    ? validateAgentSessionForThread({
        session,
        threadId,
        allowedStatuses: ['active'],
        wrongThreadMessage: 'This stop control does not belong to this agent session thread.',
      })
    : 'This stop control does not belong to this agent session thread.';
  if (!session) {
    await interaction.reply({ content: 'Agent session not found.', ephemeral: true });
    return;
  }
  if (validationError || !isStopControlForSession(interaction, session)) {
    await interaction.reply({
      content: validationError ?? 'This stop control does not belong to this agent session thread.',
      ephemeral: true,
    });
    return;
  }

  const event = buildAgentPromptStopWorkerEvent({
    session,
    actor: {
      userId: interaction.user.id,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    },
    reason: `Requested by Discord user ${interaction.user.id}`,
    messageId: interaction.message.id,
  });

  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.stop',
    summary: `Stop active agent prompt in session ${sessionId}`,
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
        content: 'You are not authorized to stop this agent session.',
        ephemeral: true,
      });
    },
  });
  if (!authorized) {
    if (!denied) {
      await interaction.update({
        content: appendStopRequestedText(interaction.message.content, interaction.user.id),
        components: [],
      });
    }
    return;
  }

  await enqueueWorkerEvent(workerEventQueue, event);
  await interaction.update({
    content: appendStopRequestedText(interaction.message.content, interaction.user.id),
    components: [],
  });
}
