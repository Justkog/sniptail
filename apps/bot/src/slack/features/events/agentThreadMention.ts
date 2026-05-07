import { findAgentSessionByThread } from '@sniptail/core/agent-sessions/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  buildSlackAgentActionValue,
  buildSlackAgentFollowUpBusyBlocks,
} from '../../agentCommandState.js';
import { postMessage } from '../../helpers.js';
import { dedupe } from '../../lib/dedupe.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { stripSlackMentions } from '../../lib/threadContext.js';
import { buildAgentSessionMessageWorkerEvent } from '../../../agentCommandShared.js';

type SlackAgentThreadMessageInput = {
  channelId?: string;
  threadId?: string;
  text?: string;
  eventTs?: string;
  userId?: string;
  workspaceId?: string;
};

export async function handleSlackAgentThreadMessage(
  {
    app,
    workerEventQueue,
    permissions,
    slackIds,
  }: Pick<SlackHandlerContext, 'app' | 'config' | 'workerEventQueue' | 'permissions' | 'slackIds'>,
  input: SlackAgentThreadMessageInput,
): Promise<boolean> {
  const { channelId, threadId, text = '', eventTs, userId, workspaceId } = input;
  if (!channelId || !threadId || !userId) {
    return false;
  }

  const session = await findAgentSessionByThread({ provider: 'slack', threadId }).catch((err) => {
    logger.warn({ err, threadId }, 'Failed to load Slack agent session for mention');
    return undefined;
  });
  if (!session) {
    return false;
  }

  const message = stripSlackMentions(text).trim();
  if (!message) {
    return true;
  }

  if (session.status === 'pending') {
    await postMessage(app, {
      channel: channelId,
      text: 'This agent session is still waiting to start.',
      threadTs: threadId,
    });
    return true;
  }
  if (session.status === 'active') {
    await postMessage(app, {
      channel: channelId,
      text: 'This agent session is busy. Queue this message for the next turn, or steer by stopping the active prompt and running this message next.',
      threadTs: threadId,
      blocks: buildSlackAgentFollowUpBusyBlocks(
        slackIds.actions.agentFollowUpQueue,
        slackIds.actions.agentFollowUpSteer,
        buildSlackAgentActionValue({
          sessionId: session.sessionId,
          messageTs: eventTs ?? threadId,
        }),
      ),
    });
    return true;
  }
  if (session.status !== 'completed') {
    await postMessage(app, {
      channel: channelId,
      text: `This agent session is ${session.status}.`,
      threadTs: threadId,
    });
    return true;
  }

  const dedupeKey = eventTs ? `${channelId}:${eventTs}:agent-session-message` : undefined;
  if (dedupeKey && dedupe(dedupeKey)) {
    return true;
  }

  const event = buildAgentSessionMessageWorkerEvent({
    session,
    actor: {
      userId,
      ...(workspaceId ? { workspaceId } : {}),
    },
    message,
    ...(eventTs ? { messageId: eventTs } : {}),
    mode: 'run',
  });

  const authorized = await authorizeSlackOperationAndRespond({
    permissions,
    client: app.client,
    slackIds,
    action: 'agent.message',
    summary: `Send agent follow-up in session ${session.sessionId}`,
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
      await postMessage(app, {
        channel: channelId,
        text: 'You are not authorized to send messages to this agent session.',
        threadTs: threadId,
      });
    },
    approvalPresentation: 'approval_only',
  });
  if (!authorized) {
    return true;
  }

  await enqueueWorkerEvent(workerEventQueue, event);
  return true;
}

export const handleSlackAgentThreadMention = handleSlackAgentThreadMessage;
