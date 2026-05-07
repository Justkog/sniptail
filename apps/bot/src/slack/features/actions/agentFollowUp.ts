import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  appendSlackAgentFollowUpAction,
  parseSlackAgentActionValue,
} from '../../agentCommandState.js';
import {
  buildAgentSessionMessageWorkerEvent,
  resolveAgentFollowUpMode,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { stripSlackMentions } from '../../lib/threadContext.js';

async function fetchSlackThreadMessage(
  client: SlackHandlerContext['app']['client'],
  channelId: string,
  threadId: string,
  messageTs: string,
): Promise<string | undefined> {
  const response = await client.conversations.replies({
    channel: channelId,
    ts: threadId,
    oldest: messageTs,
    latest: messageTs,
    inclusive: true,
    limit: 1,
  });
  const messages = (
    (response as { messages?: Array<{ text?: string; ts?: string }> }).messages ?? []
  ).filter((message) => message.ts === messageTs && typeof message.text === 'string');
  return stripSlackMentions(messages[0]?.text ?? '').trim() || undefined;
}

function registerFollowUpAction(
  actionId: string,
  mode: 'queue' | 'steer',
  context: SlackHandlerContext,
) {
  const { app, slackIds, workerEventQueue, permissions } = context;
  app.action(actionId, async ({ ack, body, client, action }) => {
    await ack();
    const value = parseSlackAgentActionValue<{ sessionId?: string; messageTs?: string }>(
      (action as { value?: string }).value,
    );
    const sessionId = value?.sessionId?.trim();
    const sourceMessageTs = value?.messageTs?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;

    if (!sessionId || !sourceMessageTs || !channelId || !threadId || !messageTs || !userId) {
      return;
    }

    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active', 'completed'],
      wrongThreadMessage: 'This follow-up control does not belong to this agent session thread.',
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

    const text = await fetchSlackThreadMessage(client, channelId, threadId, sourceMessageTs);
    if (!text) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'The original follow-up message could not be loaded.',
      });
      return;
    }

    const event = buildAgentSessionMessageWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      message: text,
      messageId: sourceMessageTs,
      mode: resolveAgentFollowUpMode(session.status, mode),
    });

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'agent.message',
      summary: `${mode === 'steer' ? 'Steer' : 'Queue'} agent follow-up in session ${sessionId}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
      },
      actor: {
        userId,
        channelId,
        threadId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      onDeny: async () => {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: 'You are not authorized to send messages to this agent session.',
        });
      },
      approvalPresentation: 'approval_only',
    });
    if (!authorized) {
      return;
    }

    await enqueueWorkerEvent(workerEventQueue, event);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: appendSlackAgentFollowUpAction(
        (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
        mode,
      ),
      blocks: [],
    });
  });
}

export function registerAgentFollowUpActions(context: SlackHandlerContext) {
  registerFollowUpAction(context.slackIds.actions.agentFollowUpQueue, 'queue', context);
  registerFollowUpAction(context.slackIds.actions.agentFollowUpSteer, 'steer', context);
}
