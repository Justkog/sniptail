import { loadAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  appendSlackAgentPermissionDecision,
  parseSlackAgentActionValue,
} from '../../agentCommandState.js';
import { getSlackAgentPermissionMessageState } from '../../slackBotChannelAdapter.js';
import {
  buildAgentInteractionResolveWorkerEvent,
  validateAgentSessionForThread,
} from '../../../agentCommandShared.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';

function registerPermissionAction(actionId: string, context: SlackHandlerContext) {
  const { app, slackIds, workerEventQueue, permissions } = context;
  app.action(actionId, async ({ ack, body, client, action }) => {
    await ack();
    const value = parseSlackAgentActionValue<{
      sessionId?: string;
      interactionId?: string;
      decision?: 'once' | 'always' | 'reject';
    }>((action as { value?: string }).value);
    const sessionId = value?.sessionId?.trim();
    const interactionId = value?.interactionId?.trim();
    const decision = value?.decision;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const threadId =
      (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
      (body as { message?: { ts?: string } }).message?.ts;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const userId = (body as { user?: { id?: string } }).user?.id;
    const workspaceId = (body as { team?: { id?: string } }).team?.id;

    if (
      !sessionId ||
      !interactionId ||
      !decision ||
      !channelId ||
      !threadId ||
      !messageTs ||
      !userId
    ) {
      return;
    }

    const session = await loadAgentSession(sessionId);
    const validationError = validateAgentSessionForThread({
      session,
      threadId,
      allowedStatuses: ['active'],
      wrongThreadMessage: 'This permission control does not belong to this agent session thread.',
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
        kind: 'permission',
        decision,
      },
    });

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'agent.interaction.resolve',
      summary: `${decision} agent permission in session ${sessionId}`,
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
          text: 'You are not authorized to resolve this agent permission request.',
        });
      },
      approvalPresentation: 'approval_only',
    });
    if (!authorized) {
      return;
    }

    await enqueueWorkerEvent(workerEventQueue, event);
    const messageState = getSlackAgentPermissionMessageState(sessionId, interactionId);
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: appendSlackAgentPermissionDecision(
        messageState?.requestText ?? (body as { message?: { text?: string } }).message?.text ?? '',
        userId,
        decision,
      ),
      blocks: [],
    });
  });
}

export function registerAgentPermissionActions(context: SlackHandlerContext) {
  registerPermissionAction(context.slackIds.actions.agentPermissionOnce, context);
  registerPermissionAction(context.slackIds.actions.agentPermissionAlways, context);
  registerPermissionAction(context.slackIds.actions.agentPermissionReject, context);
}
