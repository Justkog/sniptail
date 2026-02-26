import type { App } from '@slack/bolt';
import type { SlackIds } from '@sniptail/core/slack/ids.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type { DeferredPermissionOperation } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';
import type { SlackPermissionActorContext } from '../../permissions/permissionsGuardTypes.js';
import { resolvePermissionsProviderCapabilities } from '../../permissions/permissionsProviderCapabilities.js';
import {
  resolveSlackActorGroups,
  type GroupMembershipCacheEntry,
} from './slackPermissionsActorGroups.js';
import { logger } from '@sniptail/core/logger.js';

const slackGroupMembershipCache = new Map<string, GroupMembershipCacheEntry>();
const defaultPendingApprovalText = 'Approval required. Your request has been submitted.';

type PermissionGuardResult<TApproval = never> =
  | {
      status: 'allow';
    }
  | {
      status: 'deny';
    }
  | {
      status: 'require_approval';
      approval: TApproval;
    };

type ApprovalPresentationMode = 'default' | 'approval_only';

function resolveRequestSummaryFromOperation(
  operation: DeferredPermissionOperation,
  summary: string,
): string {
  if (operation.kind === 'enqueueJob') {
    const requestSummary = operation.job.requestText?.trim();
    if (requestSummary) {
      return requestSummary;
    }
  }
  const fallbackSummary = summary.trim();
  return fallbackSummary || 'No request text provided.';
}

function buildSlackJobRequestText(requestSummary: string): string {
  return `*Job request*\n\`\`\`\n${requestSummary}\n\`\`\``;
}

function buildSlackApprovalBlocks(
  text: string,
  slackIds: SlackIds,
  approvalId: string,
): Array<Record<string, unknown>> {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Approve',
          },
          style: 'primary',
          action_id: slackIds.actions.approvalApprove,
          value: approvalId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Deny',
          },
          style: 'danger',
          action_id: slackIds.actions.approvalDeny,
          value: approvalId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Cancel',
          },
          action_id: slackIds.actions.approvalCancel,
          value: approvalId,
        },
      ],
    },
  ];
}

export async function authorizeSlackPrecheck(input: {
  permissions: PermissionsRuntimeService;
  client: App['client'];
  action: PermissionAction;
  userId: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
}): Promise<PermissionGuardResult> {
  try {
    const authorization = await input.permissions.authorize({
      action: input.action,
      provider: 'slack',
      userId: input.userId,
      channelId: input.channelId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      resolveGroups: async (candidateGroupIds) =>
        resolveSlackActorGroups({
          client: input.client,
          userId: input.userId,
          candidateGroupIds,
          cache: slackGroupMembershipCache,
          cacheTtlMs: input.permissions.getGroupCacheTtlMs(),
        }),
    });

    if (authorization.allowed || authorization.requiresApproval) {
      return { status: 'allow' };
    }
    return { status: 'deny' };
  } catch (err) {
    logger.error(
      { err, action: input.action, userId: input.userId, channelId: input.channelId },
      'Group resolution failed during precheck; denying (fail-closed)',
    );
    return { status: 'deny' };
  }
}

export async function authorizeSlackPrecheckAndRespond(input: {
  permissions: PermissionsRuntimeService;
  client: App['client'];
  action: PermissionAction;
  actor: SlackPermissionActorContext;
  onDeny: () => Promise<void>;
}): Promise<boolean> {
  const precheck = await authorizeSlackPrecheck({
    permissions: input.permissions,
    client: input.client,
    action: input.action,
    userId: input.actor.userId,
    channelId: input.actor.channelId,
    ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
    ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
  });
  if (precheck.status === 'deny') {
    await input.onDeny();
    return false;
  }
  return true;
}

export async function authorizeSlackOperation(input: {
  permissions: PermissionsRuntimeService;
  client: App['client'];
  slackIds: SlackIds;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  userId: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
}): Promise<
  PermissionGuardResult<{
    id: string;
    text: string;
    blocks: Array<Record<string, unknown>>;
  }>
> {
  try {
    const authorization = await input.permissions.authorizeOrCreateApproval({
      action: input.action,
      provider: 'slack',
      userId: input.userId,
      channelId: input.channelId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      resolveGroups: async (candidateGroupIds) =>
        resolveSlackActorGroups({
          client: input.client,
          userId: input.userId,
          candidateGroupIds,
          cache: slackGroupMembershipCache,
          cacheTtlMs: input.permissions.getGroupCacheTtlMs(),
        }),
      summary: input.summary,
      operation: input.operation,
    });

    if (authorization.status === 'allow') {
      return { status: 'allow' };
    }
    if (authorization.status === 'deny') {
      return { status: 'deny' };
    }
    if (!resolvePermissionsProviderCapabilities('slack').approvalButtons) {
      return { status: 'deny' };
    }

    const text = input.permissions.buildApprovalMessage('slack', authorization.request);
    return {
      status: 'require_approval',
      approval: {
        id: authorization.request.id,
        text,
        blocks: buildSlackApprovalBlocks(text, input.slackIds, authorization.request.id),
      },
    };
  } catch (err) {
    logger.error(
      { err, action: input.action, userId: input.userId, channelId: input.channelId },
      'Group resolution failed during authorization; denying (fail-closed)',
    );
    return { status: 'deny' };
  }
}

async function postSlackApprovalMessage(input: {
  client: App['client'];
  channelId: string;
  threadId?: string;
  approval: {
    text: string;
    blocks: Array<Record<string, unknown>>;
  };
}) {
  await input.client.chat.postMessage({
    channel: input.channelId,
    ...(input.threadId ? { thread_ts: input.threadId } : {}),
    text: input.approval.text,
    blocks: input.approval.blocks as never,
  });
}

async function postSlackJobRequestAndResolveThread(input: {
  client: App['client'];
  channelId: string;
  existingThreadId?: string;
  requestSummary: string;
}): Promise<string | undefined> {
  try {
    const response = await input.client.chat.postMessage({
      channel: input.channelId,
      ...(input.existingThreadId ? { thread_ts: input.existingThreadId } : {}),
      text: buildSlackJobRequestText(input.requestSummary),
    });
    return input.existingThreadId ?? response.ts;
  } catch (err) {
    logger.warn({ err, channelId: input.channelId }, 'Failed to post Slack job request');
    return input.existingThreadId;
  }
}

export async function authorizeSlackOperationAndRespond(input: {
  permissions: PermissionsRuntimeService;
  client: App['client'];
  slackIds: SlackIds;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  actor: SlackPermissionActorContext;
  onDeny: () => Promise<void>;
  onRequireApprovalNotice?: (message: string) => Promise<void>;
  pendingApprovalText?: string;
  approvalPresentation?: ApprovalPresentationMode;
}): Promise<boolean> {
  const authorization = await authorizeSlackOperation({
    permissions: input.permissions,
    client: input.client,
    slackIds: input.slackIds,
    action: input.action,
    summary: input.summary,
    operation: input.operation,
    userId: input.actor.userId,
    channelId: input.actor.channelId,
    ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
    ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
  });
  if (authorization.status === 'deny') {
    await input.onDeny();
    return false;
  }
  if (authorization.status === 'require_approval') {
    const approvalPresentation = input.approvalPresentation ?? 'default';
    if (approvalPresentation === 'approval_only') {
      await postSlackApprovalMessage({
        client: input.client,
        channelId: input.actor.channelId,
        ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
        approval: authorization.approval,
      });
      return false;
    }
    if (input.onRequireApprovalNotice) {
      await input.onRequireApprovalNotice(input.pendingApprovalText ?? defaultPendingApprovalText);
    }
    const requestSummary = resolveRequestSummaryFromOperation(input.operation, input.summary);
    const requestThreadId = await postSlackJobRequestAndResolveThread({
      client: input.client,
      channelId: input.actor.channelId,
      ...(input.actor.threadId ? { existingThreadId: input.actor.threadId } : {}),
      requestSummary,
    });
    let approvalThreadId = requestThreadId;
    if (!input.actor.threadId && requestThreadId) {
      const reassigned = await input.permissions.assignApprovalThreadIfPending({
        approvalId: authorization.approval.id,
        threadId: requestThreadId,
      });
      if (!reassigned) {
        logger.warn(
          {
            approvalId: authorization.approval.id,
            channelId: input.actor.channelId,
            threadId: requestThreadId,
          },
          'Failed to reassign Slack approval thread context; posting approval without thread',
        );
        approvalThreadId = undefined;
      }
    }
    await postSlackApprovalMessage({
      client: input.client,
      channelId: input.actor.channelId,
      ...(approvalThreadId ? { threadId: approvalThreadId } : {}),
      approval: authorization.approval,
    });
    return false;
  }
  return true;
}
