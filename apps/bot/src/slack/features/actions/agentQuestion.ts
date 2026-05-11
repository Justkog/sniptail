import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { type WorkerEvent } from '@sniptail/core/types/worker-event.js';
import {
  appendSlackAgentQuestionDecision,
  buildSlackQuestionAnswers,
  clearPendingSlackAgentQuestion,
  getPendingSlackAgentQuestion,
  missingSlackQuestionHeaders,
  parseSlackAgentActionValue,
  parseSlackAgentQuestionBlockId,
  selectedLabels,
} from '../../agentCommandState.js';
import { buildAgentQuestionCustomModal } from '../../modals.js';
import {
  buildAgentInteractionResolveWorkerEvent,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

async function authorizeAndEnqueueQuestionResolution(input: {
  context: SlackHandlerContext;
  client: SlackHandlerContext['app']['client'];
  event: WorkerEvent;
  userId: string;
  channelId: string;
  threadId: string;
  workspaceId?: string;
  summary: string;
  denyText: string;
}): Promise<boolean> {
  const authorized = await authorizeSlackOperationAndRespond({
    permissions: input.context.permissions,
    client: input.client,
    slackIds: input.context.slackIds,
    action: 'agent.interaction.resolve',
    summary: input.summary,
    operation: {
      kind: 'enqueueWorkerEvent',
      event: input.event,
    },
    actor: {
      userId: input.userId,
      channelId: input.channelId,
      threadId: input.threadId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
    onDeny: async () => {
      await input.client.chat.postEphemeral({
        channel: input.channelId,
        user: input.userId,
        text: input.denyText,
      });
    },
    approvalPresentation: 'approval_only',
  });
  if (!authorized) {
    return false;
  }
  await enqueueWorkerEvent(input.context.workerEventQueue, input.event);
  return true;
}

async function validateResolvableAgentQuestionSession(input: {
  client: SlackHandlerContext['app']['client'];
  sessionId: string;
  channelId: string;
  threadId: string;
  userId: string;
}): Promise<boolean> {
  const session = await loadAgentSession(input.sessionId);
  if (!session) {
    await input.client.chat.postEphemeral({
      channel: input.channelId,
      user: input.userId,
      text: 'Agent session not found.',
    });
    return false;
  }
  if (session.threadId !== input.threadId) {
    await input.client.chat.postEphemeral({
      channel: input.channelId,
      user: input.userId,
      text: 'This question control does not belong to this agent session thread.',
    });
    return false;
  }
  if (session.status !== 'active') {
    await input.client.chat.postEphemeral({
      channel: input.channelId,
      user: input.userId,
      text: `This agent session is ${session.status}.`,
    });
    return false;
  }
  return true;
}

export function registerAgentQuestionActions(context: SlackHandlerContext) {
  const { app, slackIds, config } = context;

  app.action(slackIds.actions.agentQuestionSelect, async ({ ack, body, action, client }) => {
    await ack();
    const blockId = (action as { block_id?: string }).block_id;
    const parsed = parseSlackAgentQuestionBlockId(blockId);
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;

    if (!parsed || !channelId || !threadId || !userId) {
      return;
    }

    const pending = getPendingSlackAgentQuestion(parsed.sessionId, parsed.interactionId);
    if (!pending) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'This question request is no longer pending.',
      });
      return;
    }

    const selectedValues =
      'selected_options' in action
        ? ((action as { selected_options?: Array<{ value?: string }> }).selected_options ?? []).map(
            (option) => option.value ?? '',
          )
        : 'selected_option' in action
          ? [(action as { selected_option?: { value?: string } }).selected_option?.value ?? '']
          : [];
    pending.selections.set(
      parsed.questionIndex,
      selectedLabels(pending, parsed.questionIndex, selectedValues),
    );
    if (pending.questions.length > 1) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'Selection recorded.',
        thread_ts: threadId,
      });
      return;
    }

    if (!messageTs) {
      return;
    }
    const validSession = await validateResolvableAgentQuestionSession({
      client,
      sessionId: parsed.sessionId,
      channelId,
      threadId,
      userId,
    });
    if (!validSession) {
      return;
    }
    const session = await loadAgentSession(parsed.sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This question control does not belong to this agent session thread.',
    });
    if (validationError) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: validationError,
      });
      return;
    }
    if (!session) {
      return;
    }
    const event = buildAgentInteractionResolveWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      interactionId: parsed.interactionId,
      resolution: {
        kind: 'question',
        answers: buildSlackQuestionAnswers(pending),
      },
    });
    const authorized = await authorizeAndEnqueueQuestionResolution({
      context,
      client,
      event,
      userId,
      channelId,
      threadId,
      ...(workspaceId ? { workspaceId } : {}),
      summary: `Answer agent question in session ${parsed.sessionId}`,
      denyText: 'You are not authorized to answer this agent question.',
    });
    if (!authorized) return;
    clearPendingSlackAgentQuestion(parsed.sessionId, parsed.interactionId);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: appendSlackAgentQuestionDecision(
        (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
        'selected',
      ),
      blocks: [],
    });
  });

  app.action(slackIds.actions.agentQuestionCustom, async ({ ack, body, action, client }) => {
    await ack();
    const value = parseSlackAgentActionValue<{ sessionId?: string; interactionId?: string }>(
      (action as { value?: string }).value,
    );
    const sessionId = value?.sessionId?.trim();
    const interactionId = value?.interactionId?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    if (!sessionId || !interactionId || !channelId || !threadId) {
      return;
    }
    const pending = getPendingSlackAgentQuestion(sessionId, interactionId);
    if (!pending) {
      return;
    }
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (!triggerId) {
      return;
    }
    await client.views.open({
      trigger_id: triggerId,
      view: buildAgentQuestionCustomModal(
        config.botName,
        slackIds.actions.agentQuestionCustomSubmit,
        JSON.stringify({ sessionId, interactionId, channelId, threadId }),
        pending.questions,
      ),
    });
  });

  app.action(slackIds.actions.agentQuestionSubmit, async ({ ack, body, action, client }) => {
    await ack();
    const value = parseSlackAgentActionValue<{ sessionId?: string; interactionId?: string }>(
      (action as { value?: string }).value,
    );
    const sessionId = value?.sessionId?.trim();
    const interactionId = value?.interactionId?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;
    if (!sessionId || !interactionId || !channelId || !threadId || !messageTs || !userId) {
      return;
    }
    const validSession = await validateResolvableAgentQuestionSession({
      client,
      sessionId,
      channelId,
      threadId,
      userId,
    });
    if (!validSession) {
      return;
    }
    const pending = getPendingSlackAgentQuestion(sessionId, interactionId);
    if (!pending) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'This question request is no longer pending.',
      });
      return;
    }
    const missing = missingSlackQuestionHeaders(pending);
    if (missing.length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Please answer: ${missing.join(', ')}.`,
      });
      return;
    }
    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This question control does not belong to this agent session thread.',
    });
    if (validationError) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: validationError,
      });
      return;
    }
    if (!session) {
      return;
    }
    const event = buildAgentInteractionResolveWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      interactionId,
      resolution: {
        kind: 'question',
        answers: buildSlackQuestionAnswers(pending),
      },
    });
    const authorized = await authorizeAndEnqueueQuestionResolution({
      context,
      client,
      event,
      userId,
      channelId,
      threadId,
      ...(workspaceId ? { workspaceId } : {}),
      summary: `Answer agent question in session ${sessionId}`,
      denyText: 'You are not authorized to answer this agent question.',
    });
    if (!authorized) return;
    clearPendingSlackAgentQuestion(sessionId, interactionId);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: appendSlackAgentQuestionDecision(
        (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
        'submitted',
      ),
      blocks: [],
    });
  });

  app.action(slackIds.actions.agentQuestionReject, async ({ ack, body, action, client }) => {
    await ack();
    const value = parseSlackAgentActionValue<{ sessionId?: string; interactionId?: string }>(
      (action as { value?: string }).value,
    );
    const sessionId = value?.sessionId?.trim();
    const interactionId = value?.interactionId?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;
    if (!sessionId || !interactionId || !channelId || !threadId || !messageTs || !userId) {
      return;
    }
    const validSession = await validateResolvableAgentQuestionSession({
      client,
      sessionId,
      channelId,
      threadId,
      userId,
    });
    if (!validSession) {
      return;
    }
    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This question control does not belong to this agent session thread.',
    });
    if (validationError) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: validationError,
      });
      return;
    }
    if (!session) {
      return;
    }
    const event = buildAgentInteractionResolveWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      interactionId,
      resolution: {
        kind: 'question',
        reject: true,
      },
    });
    const authorized = await authorizeAndEnqueueQuestionResolution({
      context,
      client,
      event,
      userId,
      channelId,
      threadId,
      ...(workspaceId ? { workspaceId } : {}),
      summary: `Reject agent question in session ${sessionId}`,
      denyText: 'You are not authorized to resolve this agent question.',
    });
    if (!authorized) return;
    clearPendingSlackAgentQuestion(sessionId, interactionId);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: appendSlackAgentQuestionDecision(
        (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
        'rejected',
      ),
      blocks: [],
    });
  });

  app.view(slackIds.actions.agentQuestionCustomSubmit, async ({ ack, body, view, client }) => {
    await ack();
    const privateMetadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          sessionId: string;
          interactionId: string;
          channelId: string;
          threadId: string;
        })
      : undefined;
    const sessionId = privateMetadata?.sessionId;
    const interactionId = privateMetadata?.interactionId;
    const channelId = privateMetadata?.channelId;
    const threadId = privateMetadata?.threadId;
    const userId = body.user.id;
    if (!sessionId || !interactionId || !channelId || !threadId) {
      return;
    }
    const validSession = await validateResolvableAgentQuestionSession({
      client,
      sessionId,
      channelId,
      threadId,
      userId,
    });
    if (!validSession) {
      return;
    }

    const pending = getPendingSlackAgentQuestion(sessionId, interactionId);
    if (!pending) {
      return;
    }
    for (const [blockId, blockState] of Object.entries(view.state.values)) {
      const questionIndex = Number.parseInt(blockId.replace('question_', ''), 10);
      if (!Number.isInteger(questionIndex) || questionIndex < 0) continue;
      const answer = (blockState.answer?.value ?? '').trim();
      if (!answer) continue;
      pending.selections.set(questionIndex, [answer]);
    }
    const missing = missingSlackQuestionHeaders(pending);
    if (missing.length) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Please answer: ${missing.join(', ')}.`,
      });
      return;
    }

    const workspaceId = (body as { team?: { id?: string } }).team?.id;
    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This question control does not belong to this agent session thread.',
    });
    if (validationError) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: validationError,
      });
      return;
    }
    if (!session) {
      return;
    }
    const event = buildAgentInteractionResolveWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      interactionId,
      resolution: {
        kind: 'question',
        answers: buildSlackQuestionAnswers(pending),
      },
    });
    const authorized = await authorizeAndEnqueueQuestionResolution({
      context,
      client,
      event,
      userId,
      channelId,
      threadId,
      ...(workspaceId ? { workspaceId } : {}),
      summary: `Answer agent question in session ${sessionId}`,
      denyText: 'You are not authorized to answer this agent question.',
    });
    if (!authorized) return;
    clearPendingSlackAgentQuestion(sessionId, interactionId);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: 'Answer submitted.',
    });
  });
}
