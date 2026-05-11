import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  clearPendingDiscordAgentQuestion,
  handleAgentQuestionButton,
  handleAgentQuestionModalSubmit,
  handleAgentQuestionSelect,
  setPendingDiscordAgentQuestion,
} from './agentQuestion.js';

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    provider: 'discord',
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setQuestion(overrides: Record<string, unknown> = {}) {
  setPendingDiscordAgentQuestion({
    channelId: 'thread-1',
    threadId: 'thread-1',
    sessionId: 'session-1',
    interactionId: 'interaction-1',
    workspaceKey: 'snatch',
    expiresAt: '2026-01-01T00:30:00.000Z',
    questions: [
      {
        header: 'Target',
        question: 'Which package?',
        options: [{ label: 'Worker' }, { label: 'Bot' }],
        multiple: false,
        custom: true,
      },
    ],
    ...overrides,
  });
}

function buildInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'thread-1',
    guildId: 'guild-1',
    user: { id: 'user-2' },
    member: {},
    client: {},
    message: {
      id: 'message-1',
      content: '**Question requested**',
    },
    channel: {
      isThread: () => true,
    },
    values: ['0'],
    fields: {
      fields: new Map<string, { customId: string }>(),
      getTextInputValue: vi.fn(),
    },
    reply: vi.fn(),
    update: vi.fn(),
    showModal: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  };
}

const config = { botName: 'Sniptail' };
const queue = {};
const permissions = {};

describe('handleAgentQuestion interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingDiscordAgentQuestion('session-1', 'interaction-1');
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('enqueues ordered answers for a single-question select', async () => {
    setQuestion();
    const interaction = buildInteraction({ values: ['1'] });

    await handleAgentQuestionSelect(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', questionIndex: 0 },
      config as never,
      queue as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      resolution: {
        kind: 'question',
        answers: [['Bot']],
      },
    });
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.interaction.resolve' }),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content: '**Question requested**\n\nQuestion answer selected by <@user-2>.',
      components: [],
    });
  });

  it('records multi-question selections and submits merged answers', async () => {
    setQuestion({
      questions: [
        {
          header: 'Target',
          question: 'Which package?',
          options: [{ label: 'Worker' }, { label: 'Bot' }],
          multiple: false,
          custom: true,
        },
        {
          header: 'Checks',
          question: 'Which checks?',
          options: [{ label: 'Tests' }, { label: 'Build' }],
          multiple: true,
          custom: false,
        },
      ],
    });

    await handleAgentQuestionSelect(
      buildInteraction({ values: ['0'] }) as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', questionIndex: 0 },
      config as never,
      queue as never,
      permissions as never,
    );
    await handleAgentQuestionSelect(
      buildInteraction({ values: ['0', '1'] }) as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', questionIndex: 1 },
      config as never,
      queue as never,
      permissions as never,
    );
    const submitInteraction = buildInteraction();
    await handleAgentQuestionButton(
      submitInteraction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', action: 'submit' },
      config as never,
      queue as never,
      permissions as never,
    );

    const event = hoisted.enqueueWorkerEvent.mock.calls[0]?.[1] as WorkerEvent | undefined;
    expect(event?.payload.resolution).toEqual({
      kind: 'question',
      answers: [['Worker'], ['Tests', 'Build']],
    });
    expect(submitInteraction.update).toHaveBeenCalledWith({
      content: '**Question requested**\n\nQuestion submitted by <@user-2>.',
      components: [],
    });
  });

  it('submits custom modal text answers', async () => {
    setQuestion();
    const fields = {
      fields: new Map<string, { customId: string }>([['qtext:0', { customId: 'qtext:0' }]]),
      getTextInputValue: vi.fn().mockReturnValue('Use the worker package'),
    };
    const interaction = buildInteraction({ fields });

    await handleAgentQuestionModalSubmit(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1' },
      config as never,
      queue as never,
      permissions as never,
    );

    const event = hoisted.enqueueWorkerEvent.mock.calls[0]?.[1] as WorkerEvent | undefined;
    expect(event?.payload.resolution).toEqual({
      kind: 'question',
      answers: [['Use the worker package']],
    });
    expect(interaction.editReply).toHaveBeenCalledWith('Answer submitted.');
  });

  it('enqueues question rejection events', async () => {
    setQuestion();
    const interaction = buildInteraction();

    await handleAgentQuestionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', action: 'reject' },
      config as never,
      queue as never,
      permissions as never,
    );

    const event = hoisted.enqueueWorkerEvent.mock.calls[0]?.[1] as WorkerEvent | undefined;
    expect(event?.payload.resolution).toEqual({
      kind: 'question',
      reject: true,
    });
    expect(interaction.update).toHaveBeenCalledWith({
      content: '**Question requested**\n\nQuestion rejected by <@user-2>.',
      components: [],
    });
  });
});
