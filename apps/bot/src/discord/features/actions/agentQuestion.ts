import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import {
  buildDiscordAgentQuestionModalCustomId,
  buildDiscordAgentQuestionTextInputCustomId,
  parseDiscordAgentQuestionTextInputCustomId,
  type DiscordAgentQuestionAction,
} from '@sniptail/core/discord/components.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotAgentQuestionRequestPayload } from '@sniptail/core/types/bot-event.js';
import {
  WORKER_EVENT_SCHEMA_VERSION,
  type WorkerEvent,
} from '@sniptail/core/types/worker-event.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import type { PermissionsRuntimeService } from '../../../permissions/permissionsRuntimeService.js';
import { authorizeDiscordOperationAndRespond } from '../../permissions/discordPermissionGuards.js';

type PendingDiscordAgentQuestion = BotAgentQuestionRequestPayload & {
  selections: Map<number, string[]>;
};

const pendingDiscordAgentQuestions = new Map<string, PendingDiscordAgentQuestion>();

function questionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

export function setPendingDiscordAgentQuestion(payload: BotAgentQuestionRequestPayload): void {
  pendingDiscordAgentQuestions.set(questionKey(payload.sessionId, payload.interactionId), {
    ...payload,
    selections: new Map(),
  });
}

export function clearPendingDiscordAgentQuestion(sessionId: string, interactionId: string): void {
  pendingDiscordAgentQuestions.delete(questionKey(sessionId, interactionId));
}

function getPendingDiscordAgentQuestion(
  sessionId: string,
  interactionId: string,
): PendingDiscordAgentQuestion | undefined {
  return pendingDiscordAgentQuestions.get(questionKey(sessionId, interactionId));
}

function getMessageThreadId(message: ButtonInteraction['message']): string | undefined {
  const thread = message.thread;
  return typeof thread?.id === 'string' ? thread.id : undefined;
}

function isQuestionControlForSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
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

function buildAnswers(pending: PendingDiscordAgentQuestion): string[][] {
  return pending.questions.map((_, index) => pending.selections.get(index) ?? []);
}

function questionLabel(
  question: PendingDiscordAgentQuestion['questions'][number],
  index: number,
): string {
  const header = question.header?.trim();
  if (header) {
    return header;
  }
  return question.question.trim() || `Question ${index + 1}`;
}

function missingQuestionHeaders(pending: PendingDiscordAgentQuestion): string[] {
  return pending.questions
    .map((question, index) => ({
      header: questionLabel(question, index),
      answers: pending.selections.get(index) ?? [],
    }))
    .filter((entry) => entry.answers.length === 0)
    .map((entry) => entry.header);
}

function selectedLabels(
  pending: PendingDiscordAgentQuestion,
  questionIndex: number,
  values: string[],
): string[] {
  const question = pending.questions[questionIndex];
  if (!question) return [];
  return values
    .map((value) => Number.parseInt(value, 10))
    .filter((optionIndex) => Number.isInteger(optionIndex) && optionIndex >= 0)
    .map((optionIndex) => question.options[optionIndex]?.label)
    .filter((label): label is string => typeof label === 'string' && label.length > 0);
}

function appendQuestionDecisionText(
  content: string,
  userId: string,
  action: 'submitted' | 'rejected' | 'selected',
): string {
  const base = content.trim() || 'Question requested.';
  const label =
    action === 'submitted'
      ? 'Question submitted'
      : action === 'selected'
        ? 'Question answer selected'
        : 'Question rejected';
  return `${base}\n\n${label} by <@${userId}>.`;
}

function buildQuestionResolveEvent(input: {
  sessionId: string;
  interactionId: string;
  session: NonNullable<Awaited<ReturnType<typeof loadAgentSession>>>;
  userId: string;
  guildId?: string;
  answers?: string[][];
  reject?: boolean;
}): WorkerEvent {
  return {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: input.sessionId,
      response: {
        provider: 'discord',
        channelId: input.session.threadId,
        threadId: input.session.threadId,
        userId: input.userId,
        workspaceId: input.session.workspaceKey,
        ...(input.guildId ? { guildId: input.guildId } : {}),
      },
      interactionId: input.interactionId,
      resolution: {
        kind: 'question',
        ...(input.answers ? { answers: input.answers } : {}),
        ...(input.reject ? { reject: true } : {}),
      },
    },
  };
}

async function validateQuestionInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  input: { sessionId: string; interactionId: string },
) {
  const session = await loadAgentSession(input.sessionId);
  if (!session) {
    await interaction.reply({ content: 'Agent session not found.', ephemeral: true });
    return undefined;
  }
  if (!isQuestionControlForSession(interaction, session)) {
    await interaction.reply({
      content: 'This question control does not belong to this agent session thread.',
      ephemeral: true,
    });
    return undefined;
  }
  if (session.status !== 'active') {
    await interaction.reply({
      content: `This agent session is ${session.status}.`,
      ephemeral: true,
    });
    return undefined;
  }
  return session;
}

async function authorizeAndEnqueueQuestionResolution(input: {
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;
  config: BotConfig;
  workerEventQueue: QueuePublisher<WorkerEvent>;
  permissions: PermissionsRuntimeService;
  event: WorkerEvent;
  responseChannelId: string;
  summary: string;
  denyMessage: string;
}): Promise<boolean> {
  const interactionThreadId =
    input.interaction.channel?.isThread() && input.interaction.channelId
      ? input.interaction.channelId
      : undefined;
  let denied = false;
  const authorized = await authorizeDiscordOperationAndRespond({
    permissions: input.permissions,
    botName: input.config.botName,
    action: 'agent.interaction.resolve',
    summary: input.summary,
    operation: {
      kind: 'enqueueWorkerEvent',
      event: input.event,
    },
    actor: {
      userId: input.interaction.user.id,
      channelId: input.interaction.channelId ?? input.responseChannelId,
      ...(interactionThreadId ? { threadId: interactionThreadId } : {}),
      ...(input.interaction.guildId ? { guildId: input.interaction.guildId } : {}),
      member: input.interaction.member,
    },
    client: input.interaction.client,
    approvalPresentation: 'approval_only',
    onDeny: async () => {
      denied = true;
      if (input.interaction.deferred || input.interaction.replied) {
        await input.interaction.editReply(input.denyMessage);
      } else {
        await input.interaction.reply({ content: input.denyMessage, ephemeral: true });
      }
    },
  });
  if (!authorized) return false;
  await enqueueWorkerEvent(input.workerEventQueue, input.event);
  return !denied;
}

export async function handleAgentQuestionSelect(
  interaction: StringSelectMenuInteraction,
  input: {
    sessionId: string;
    interactionId: string;
    questionIndex: number;
  },
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<void> {
  const session = await validateQuestionInteraction(interaction, input);
  if (!session) return;
  const pending = getPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  if (!pending) {
    await interaction.reply({
      content: 'This question request is no longer pending.',
      ephemeral: true,
    });
    return;
  }

  pending.selections.set(
    input.questionIndex,
    selectedLabels(pending, input.questionIndex, interaction.values),
  );
  if (pending.questions.length > 1) {
    await interaction.reply({ content: 'Selection recorded.', ephemeral: true });
    return;
  }

  const event = buildQuestionResolveEvent({
    sessionId: input.sessionId,
    interactionId: input.interactionId,
    session,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    answers: buildAnswers(pending),
  });
  const authorized = await authorizeAndEnqueueQuestionResolution({
    interaction,
    config,
    workerEventQueue,
    permissions,
    event,
    responseChannelId: session.threadId,
    summary: `Answer OpenCode question in session ${input.sessionId}`,
    denyMessage: 'You are not authorized to answer this agent question.',
  });
  if (!authorized) return;
  clearPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  await interaction.update({
    content: appendQuestionDecisionText(
      interaction.message.content,
      interaction.user.id,
      'selected',
    ),
    components: [],
  });
}

function buildQuestionModal(pending: PendingDiscordAgentQuestion) {
  const modal = new ModalBuilder()
    .setCustomId(buildDiscordAgentQuestionModalCustomId(pending.sessionId, pending.interactionId))
    .setTitle('Answer question');
  const customQuestions = pending.questions
    .map((question, index) => ({ question, index }))
    .filter((entry) => entry.question.custom)
    .slice(0, 5);
  modal.addLabelComponents(
    ...customQuestions.map((entry) => {
      const input = new TextInputBuilder()
        .setCustomId(buildDiscordAgentQuestionTextInputCustomId(entry.index))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);
      return new LabelBuilder()
        .setLabel(questionLabel(entry.question, entry.index).slice(0, 45))
        .setTextInputComponent(input);
    }),
  );
  return modal;
}

export async function handleAgentQuestionButton(
  interaction: ButtonInteraction,
  input: {
    sessionId: string;
    interactionId: string;
    action: DiscordAgentQuestionAction;
  },
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<void> {
  const session = await validateQuestionInteraction(interaction, input);
  if (!session) return;
  const pending = getPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  if (!pending) {
    await interaction.reply({
      content: 'This question request is no longer pending.',
      ephemeral: true,
    });
    return;
  }

  if (input.action === 'custom') {
    await interaction.showModal(buildQuestionModal(pending));
    return;
  }

  if (input.action === 'submit') {
    const missing = missingQuestionHeaders(pending);
    if (missing.length) {
      await interaction.reply({
        content: `Please answer: ${missing.join(', ')}.`,
        ephemeral: true,
      });
      return;
    }
  }

  const event = buildQuestionResolveEvent({
    sessionId: input.sessionId,
    interactionId: input.interactionId,
    session,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    ...(input.action === 'reject' ? { reject: true } : { answers: buildAnswers(pending) }),
  });
  const authorized = await authorizeAndEnqueueQuestionResolution({
    interaction,
    config,
    workerEventQueue,
    permissions,
    event,
    responseChannelId: session.threadId,
    summary:
      input.action === 'reject'
        ? `Reject OpenCode question in session ${input.sessionId}`
        : `Answer OpenCode question in session ${input.sessionId}`,
    denyMessage: 'You are not authorized to resolve this agent question.',
  });
  if (!authorized) return;
  clearPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  await interaction.update({
    content: appendQuestionDecisionText(
      interaction.message.content,
      interaction.user.id,
      input.action === 'reject' ? 'rejected' : 'submitted',
    ),
    components: [],
  });
}

export async function handleAgentQuestionModalSubmit(
  interaction: ModalSubmitInteraction,
  input: {
    sessionId: string;
    interactionId: string;
  },
  config: BotConfig,
  workerEventQueue: QueuePublisher<WorkerEvent>,
  permissions: PermissionsRuntimeService,
): Promise<void> {
  const pending = getPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  if (!pending) {
    await interaction.reply({
      content: 'This question request is no longer pending.',
      ephemeral: true,
    });
    return;
  }
  const session = await loadAgentSession(input.sessionId);
  if (!session) {
    await interaction.reply({ content: 'Agent session not found.', ephemeral: true });
    return;
  }
  if (session.status !== 'active') {
    await interaction.reply({
      content: `This agent session is ${session.status}.`,
      ephemeral: true,
    });
    return;
  }

  for (const field of interaction.fields.fields.values()) {
    const questionIndex = parseDiscordAgentQuestionTextInputCustomId(field.customId);
    if (questionIndex === undefined) continue;
    const value = interaction.fields.getTextInputValue(field.customId).trim();
    if (!value) continue;
    pending.selections.set(questionIndex, [value]);
  }
  const missing = missingQuestionHeaders(pending);
  if (missing.length) {
    await interaction.reply({
      content: `Please answer: ${missing.join(', ')}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const event = buildQuestionResolveEvent({
    sessionId: input.sessionId,
    interactionId: input.interactionId,
    session,
    userId: interaction.user.id,
    ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
    answers: buildAnswers(pending),
  });
  const authorized = await authorizeAndEnqueueQuestionResolution({
    interaction,
    config,
    workerEventQueue,
    permissions,
    event,
    responseChannelId: session.threadId,
    summary: `Answer OpenCode question in session ${input.sessionId}`,
    denyMessage: 'You are not authorized to answer this agent question.',
  });
  if (!authorized) return;
  clearPendingDiscordAgentQuestion(input.sessionId, input.interactionId);
  await interaction.editReply('Answer submitted.');
}
