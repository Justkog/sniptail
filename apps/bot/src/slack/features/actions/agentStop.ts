import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import { appendSlackAgentStopRequested } from '../../agentCommandState.js';
import {
  buildAgentPromptStopWorkerEvent,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

export function registerAgentStopAction({
  app,
  slackIds,
  workerEventQueue,
  permissions,
}: SlackHandlerContext) {
  app.action(slackIds.actions.agentStop, async ({ ack, body, client, action }) => {
    await ack();
    const sessionId = (action as { value?: string }).value?.trim();
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;

    if (!sessionId || !channelId || !threadId || !userId || !messageTs) {
      return;
    }

    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This stop control does not belong to this agent session thread.',
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

    const event = buildAgentPromptStopWorkerEvent({
      session,
      actor: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      reason: `Requested by Slack user ${userId}`,
      messageId: messageTs,
    });

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'agent.stop',
      summary: `Stop active agent prompt in session ${sessionId}`,
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
          text: 'You are not authorized to stop this agent session.',
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
      text: appendSlackAgentStopRequested(
        (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
      ),
      blocks: [],
    });
  });
}
