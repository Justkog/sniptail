import type { App } from '@slack/bolt';
import type { SlackHandlerContext } from '../context.js';
import {
  resolveSlackActorGroups,
  type GroupMembershipCacheEntry,
} from '../../permissions/slackPermissionsActorGroups.js';

const slackGroupMembershipCache = new Map<string, GroupMembershipCacheEntry>();

type ApprovalActionId = 'approvalApprove' | 'approvalDeny' | 'approvalCancel';

function toResolutionAction(
  action: ApprovalActionId,
): 'approval.grant' | 'approval.deny' | 'approval.cancel' {
  if (action === 'approvalApprove') return 'approval.grant';
  if (action === 'approvalDeny') return 'approval.deny';
  return 'approval.cancel';
}

async function handleApprovalAction(
  app: App,
  context: SlackHandlerContext,
  input: {
    approvalAction: ApprovalActionId;
    approvalId?: string | undefined;
    userId?: string | undefined;
    channelId?: string | undefined;
    threadId?: string | undefined;
    messageTs?: string | undefined;
    workspaceId?: string | undefined;
  },
) {
  const { permissions } = context;
  const approvalId = input.approvalId?.trim();
  const userId = input.userId?.trim();
  const channelId = input.channelId?.trim();
  if (!approvalId || !userId || !channelId) {
    return;
  }
  const result = await permissions.resolveApprovalInteraction({
    action: toResolutionAction(input.approvalAction),
    resolutionAction: toResolutionAction(input.approvalAction),
    approvalId,
    provider: 'slack',
    userId,
    channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    resolveGroups: async (candidateGroupIds: string[]) =>
      resolveSlackActorGroups({
        client: app.client,
        userId,
        candidateGroupIds,
        cache: slackGroupMembershipCache,
        cacheTtlMs: permissions.getGroupCacheTtlMs(),
      }),
  });

  if (
    input.messageTs &&
    (result.status === 'approved' || result.status === 'denied' || result.status === 'cancelled')
  ) {
    await app.client.chat.update({
      channel: channelId,
      ts: input.messageTs,
      text: result.message,
      blocks: [],
    });
  }

  await app.client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: result.message,
    ...(input.threadId ? { thread_ts: input.threadId } : {}),
  });
}

export function registerApprovalActions(context: SlackHandlerContext) {
  const { app, slackIds } = context;

  app.action(slackIds.actions.approvalApprove, async ({ ack, body, action }) => {
    await ack();
    await handleApprovalAction(app, context, {
      approvalAction: 'approvalApprove',
      approvalId: (action as { value?: string }).value,
      userId: (body as { user?: { id?: string } }).user?.id,
      channelId: (body as { channel?: { id?: string } }).channel?.id,
      threadId:
        (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
        (body as { message?: { ts?: string } }).message?.ts,
      messageTs: (body as { message?: { ts?: string } }).message?.ts,
      workspaceId: (body as { team?: { id?: string } }).team?.id,
    });
  });

  app.action(slackIds.actions.approvalDeny, async ({ ack, body, action }) => {
    await ack();
    await handleApprovalAction(app, context, {
      approvalAction: 'approvalDeny',
      approvalId: (action as { value?: string }).value,
      userId: (body as { user?: { id?: string } }).user?.id,
      channelId: (body as { channel?: { id?: string } }).channel?.id,
      threadId:
        (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
        (body as { message?: { ts?: string } }).message?.ts,
      messageTs: (body as { message?: { ts?: string } }).message?.ts,
      workspaceId: (body as { team?: { id?: string } }).team?.id,
    });
  });

  app.action(slackIds.actions.approvalCancel, async ({ ack, body, action }) => {
    await ack();
    await handleApprovalAction(app, context, {
      approvalAction: 'approvalCancel',
      approvalId: (action as { value?: string }).value,
      userId: (body as { user?: { id?: string } }).user?.id,
      channelId: (body as { channel?: { id?: string } }).channel?.id,
      threadId:
        (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts ??
        (body as { message?: { ts?: string } }).message?.ts,
      messageTs: (body as { message?: { ts?: string } }).message?.ts,
      workspaceId: (body as { team?: { id?: string } }).team?.id,
    });
  });
}
