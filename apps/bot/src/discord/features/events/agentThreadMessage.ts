import type { Message } from 'discord.js';
import { findDiscordAgentSessionByThread } from '@sniptail/core/agent-sessions/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { buildDiscordAgentFollowUpBusyComponents } from '@sniptail/core/discord/components.js';
import { type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { truncateRequestSummary } from '../../../lib/jobs.js';
import { dedupe } from '../../../slack/lib/dedupe.js';
import { buildAgentSessionMessageWorkerEvent } from '../../../agentCommandShared.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';

export async function handleAgentThreadMessage(
  message: Message,
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<boolean> {
  if (!message.channel.isThread()) {
    return false;
  }

  const session = await findDiscordAgentSessionByThread(message.channelId).catch((err) => {
    logger.warn(
      { err, channelId: message.channelId },
      'Failed to load Discord agent session for thread message',
    );
    return undefined;
  });
  if (!session) {
    return false;
  }

  const text = message.content.trim();
  if (!text) {
    return true;
  }

  if (session.status === 'pending') {
    await message.reply('This agent session is still waiting to start.');
    return true;
  }
  if (session.status === 'active') {
    await message.reply({
      content:
        'This agent session is busy. Queue this message for the next turn, or steer by stopping the active prompt and running this message next.',
      components: buildDiscordAgentFollowUpBusyComponents(session.sessionId, message.id),
    });
    return true;
  }
  if (session.status !== 'completed') {
    await message.reply(`This agent session is ${session.status}.`);
    return true;
  }

  const dedupeKey = `${message.channelId}:${message.id}:agent-session-message`;
  if (dedupe(dedupeKey)) return true;

  const event = buildAgentSessionMessageWorkerEvent({
    session,
    actor: {
      userId: message.author.id,
      ...(message.guildId ? { guildId: message.guildId } : {}),
    },
    message: text,
    messageId: message.id,
    mode: 'run',
  });

  const authorized = await authorizeDiscordOperationAndRespond({
    permissions,
    botName: config.botName,
    action: 'agent.message',
    summary: `Send agent follow-up in session ${session.sessionId}: "${truncateRequestSummary(text)}"`,
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    actor: {
      userId: message.author.id,
      channelId: message.channelId,
      threadId: message.channelId,
      ...(message.guildId ? { guildId: message.guildId } : {}),
      member: message.member,
    },
    client: message.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      await message.reply('You are not authorized to send messages to this agent session.');
    },
  });
  if (!authorized) {
    return true;
  }

  await enqueueWorkerEvent(workerEventQueue, event);
  return true;
}
