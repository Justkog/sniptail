import type { ButtonInteraction } from 'discord.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { DiscordAgentPermissionDecision } from '@sniptail/core/discord/components.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';

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
  if (!isPermissionControlForSession(interaction, session)) {
    await interaction.reply({
      content: 'This permission control does not belong to this agent session thread.',
      ephemeral: true,
    });
    return;
  }
  if (session.status !== 'active') {
    await interaction.reply({
      content: `This agent session is ${session.status}.`,
      ephemeral: true,
    });
    return;
  }

  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.interaction.resolve',
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
      interactionId: input.interactionId,
      resolution: {
        kind: 'permission',
        decision: input.decision,
      },
    },
  };

  let denied = false;
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
          interaction.message.content,
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
    content: appendDecisionText(interaction.message.content, interaction.user.id, input.decision),
    components: [],
  });
}
