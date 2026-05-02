import type { ButtonInteraction, Message } from 'discord.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { DiscordAgentFollowUpAction } from '@sniptail/core/discord/components.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { truncateRequestSummary } from '../../../lib/jobs.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';

function getMessageThreadId(message: ButtonInteraction['message']): string | undefined {
  const thread = message.thread;
  return typeof thread?.id === 'string' ? thread.id : undefined;
}

function isFollowUpControlForSession(
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

async function fetchSourceMessage(
  interaction: ButtonInteraction,
  messageId: string,
): Promise<Message | undefined> {
  const channel = interaction.channel;
  if (!channel?.isTextBased()) return undefined;
  const messages = (channel as { messages?: { fetch(id: string): Promise<Message> } }).messages;
  if (!messages) return undefined;
  return messages.fetch(messageId).catch(() => undefined);
}

function actionSummary(action: DiscordAgentFollowUpAction): string {
  return action === 'steer' ? 'Steer' : 'Queue';
}

function appendFollowUpActionText(
  content: string,
  userId: string,
  action: DiscordAgentFollowUpAction,
): string {
  const base = content.trim() || 'Agent session is busy.';
  return `${base}\n\n${actionSummary(action)} selected by <@${userId}>.`;
}

export async function handleAgentFollowUpButton(
  interaction: ButtonInteraction,
  input: {
    sessionId: string;
    messageId: string;
    action: DiscordAgentFollowUpAction;
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
  if (!isFollowUpControlForSession(interaction, session)) {
    await interaction.reply({
      content: 'This follow-up control does not belong to this agent session thread.',
      ephemeral: true,
    });
    return;
  }
  if (session.status !== 'active' && session.status !== 'completed') {
    await interaction.reply({
      content: `This agent session is ${session.status}.`,
      ephemeral: true,
    });
    return;
  }

  const source = await fetchSourceMessage(interaction, input.messageId);
  const text = source?.content.trim();
  if (!text) {
    await interaction.reply({
      content: 'The original follow-up message could not be loaded.',
      ephemeral: true,
    });
    return;
  }

  const mode: 'run' | 'queue' | 'steer' = session.status === 'active' ? input.action : 'run';
  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.session.message',
    payload: {
      sessionId: input.sessionId,
      response: {
        provider: 'discord',
        channelId: session.threadId,
        threadId: session.threadId,
        userId: interaction.user.id,
        workspaceId: session.workspaceKey,
        ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      },
      message: text,
      messageId: input.messageId,
      mode,
    },
  };

  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.message',
    summary: `${actionSummary(input.action)} agent follow-up in session ${
      input.sessionId
    }: "${truncateRequestSummary(text)}"`,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    actor: {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      threadId: session.threadId,
      ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
      member: interaction.member,
    },
    client: interaction.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      denied = true;
      await interaction.reply({
        content: 'You are not authorized to send messages to this agent session.',
        ephemeral: true,
      });
    },
  });
  if (!authorized) {
    if (!denied) {
      await interaction.update({
        content: appendFollowUpActionText(
          interaction.message.content,
          interaction.user.id,
          input.action,
        ),
        components: [],
      });
    }
    return;
  }

  await enqueueWorkerEvent(workerEventQueue, event);
  await interaction.update({
    content: appendFollowUpActionText(
      interaction.message.content,
      interaction.user.id,
      input.action,
    ),
    components: [],
  });
}
