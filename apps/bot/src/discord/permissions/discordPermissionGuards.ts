import {
  buildDiscordApprovalComponents,
  type DiscordApprovalAction,
} from '@sniptail/core/discord/components.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type { DeferredPermissionOperation } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import { logger } from '@sniptail/core/logger.js';
import { toSlackCommandPrefix } from '@sniptail/core/utils/slack.js';
import { isSendableTextChannel, postDiscordMessage } from '../helpers.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';
import type { DiscordPermissionActorContext } from '../../permissions/permissionsGuardTypes.js';
import { resolvePermissionsProviderCapabilities } from '../../permissions/permissionsProviderCapabilities.js';
import { resolveDiscordActorGroups } from './discordPermissionsActorGroups.js';
import { truncateRequestSummary } from '../../lib/jobs.js';

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
      return truncateRequestSummary(requestSummary);
    }
  }
  const fallbackSummary = summary.trim();
  return truncateRequestSummary(fallbackSummary);
}

function buildDiscordJobRequestText(requestSummary: string, jobId?: string): string {
  const title = jobId ? `**Job request: ${jobId}**` : '**Job request**';
  return `${title}\n\`\`\`\n${requestSummary}\n\`\`\``;
}

export function extractDiscordRoleIds(member: unknown): string[] {
  if (!member || typeof member !== 'object' || !('roles' in member)) {
    return [];
  }
  const rolesValue = (member as { roles?: unknown }).roles;
  if (Array.isArray(rolesValue)) {
    return rolesValue.filter((roleId): roleId is string => typeof roleId === 'string');
  }
  if (
    rolesValue &&
    typeof rolesValue === 'object' &&
    'cache' in rolesValue &&
    (rolesValue as { cache?: Map<string, unknown> }).cache
  ) {
    return Array.from((rolesValue as { cache: Map<string, unknown> }).cache.keys());
  }
  return [];
}

export async function authorizeDiscordPrecheck(input: {
  permissions: PermissionsRuntimeService;
  action: PermissionAction;
  userId: string;
  channelId: string;
  threadId?: string;
  guildId?: string;
  roleIds?: string[];
}): Promise<PermissionGuardResult> {
  const authorization = await input.permissions.authorize({
    action: input.action,
    provider: 'discord',
    userId: input.userId,
    channelId: input.channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.guildId ? { guildId: input.guildId } : {}),
    groupIds: input.roleIds ?? [],
    // eslint-disable-next-line @typescript-eslint/require-await
    resolveGroups: async (candidateGroupIds) =>
      resolveDiscordActorGroups({
        roleIds: input.roleIds ?? [],
        candidateGroupIds,
      }),
  });

  if (authorization.allowed || authorization.requiresApproval) {
    return { status: 'allow' };
  }
  return { status: 'deny' };
}

export async function authorizeDiscordPrecheckAndRespond(input: {
  permissions: PermissionsRuntimeService;
  action: PermissionAction;
  actor: DiscordPermissionActorContext;
  onDeny: () => Promise<void>;
}): Promise<boolean> {
  const precheck = await authorizeDiscordPrecheck({
    permissions: input.permissions,
    action: input.action,
    userId: input.actor.userId,
    channelId: input.actor.channelId,
    ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
    ...(input.actor.guildId ? { guildId: input.actor.guildId } : {}),
    roleIds: extractDiscordRoleIds(input.actor.member),
  });
  if (precheck.status === 'deny') {
    await input.onDeny();
    return false;
  }
  return true;
}

export async function authorizeDiscordOperation(input: {
  permissions: PermissionsRuntimeService;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  userId: string;
  channelId: string;
  threadId?: string;
  guildId?: string;
  roleIds?: string[];
}): Promise<
  PermissionGuardResult<{
    id: string;
    text: string;
    components: ReturnType<typeof buildDiscordApprovalComponents>;
  }>
> {
  const authorization = await input.permissions.authorizeOrCreateApproval({
    action: input.action,
    provider: 'discord',
    userId: input.userId,
    channelId: input.channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.guildId ? { guildId: input.guildId } : {}),
    groupIds: input.roleIds ?? [],
    // eslint-disable-next-line @typescript-eslint/require-await
    resolveGroups: async (candidateGroupIds) =>
      resolveDiscordActorGroups({
        roleIds: input.roleIds ?? [],
        candidateGroupIds,
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
  if (!resolvePermissionsProviderCapabilities('discord').approvalButtons) {
    return { status: 'deny' };
  }

  const text = input.permissions.buildApprovalMessage('discord', authorization.request);
  return {
    status: 'require_approval',
    approval: {
      id: authorization.request.id,
      text,
      components: buildDiscordApprovalComponents(authorization.request.id),
    },
  };
}

async function postDiscordApprovalMessage(input: {
  client: Parameters<typeof postDiscordMessage>[0];
  channelId: string;
  threadId?: string;
  approval: {
    text: string;
    components: ReturnType<typeof buildDiscordApprovalComponents>;
  };
}) {
  await postDiscordMessage(input.client, {
    channelId: input.channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    text: input.approval.text,
    components: input.approval.components,
  });
}

async function postDiscordJobRequestAndResolveThread(input: {
  client: Parameters<typeof postDiscordMessage>[0];
  botName: string;
  channelId: string;
  existingThreadId?: string;
  requestSummary: string;
  approvalId: string;
  jobId?: string;
  contextFiles?: JobContextFile[];
}): Promise<{ threadId?: string; requestMessageId?: string }> {
  const text = buildDiscordJobRequestText(input.requestSummary, input.jobId);
  const botNamePrefix = toSlackCommandPrefix(input.botName);
  if (input.existingThreadId) {
    try {
      const requestMessage = await postDiscordMessage(input.client, {
        channelId: input.channelId,
        threadId: input.existingThreadId,
        text,
        ...(input.contextFiles?.length ? { contextFiles: input.contextFiles } : {}),
      });
      return {
        threadId: input.existingThreadId,
        ...(requestMessage?.id ? { requestMessageId: requestMessage.id } : {}),
      };
    } catch (err) {
      logger.warn(
        { err, channelId: input.channelId, threadId: input.existingThreadId },
        'Failed to post Discord job request in existing thread',
      );
    }
    return { threadId: input.existingThreadId };
  }

  try {
    const channel = await input.client.channels.fetch(input.channelId);
    if (!channel?.isTextBased() || !isSendableTextChannel(channel)) {
      logger.warn({ channelId: input.channelId }, 'Discord channel is not sendable for approvals');
      return {};
    }
    const requestMessage = await postDiscordMessage(input.client, {
      channelId: input.channelId,
      channel,
      text,
      ...(input.contextFiles?.length ? { contextFiles: input.contextFiles } : {}),
    });
    const threadName = `${botNamePrefix} approval ${input.approvalId}`.slice(0, 100);
    try {
      const thread = await requestMessage.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
      });
      return {
        threadId: thread.id,
        requestMessageId: requestMessage.id,
      };
    } catch (err) {
      logger.warn({ err, channelId: input.channelId }, 'Failed to create Discord approval thread');
      return {
        requestMessageId: requestMessage.id,
      };
    }
  } catch (err) {
    logger.warn({ err, channelId: input.channelId }, 'Failed to post Discord job request');
    return {};
  }
}

export async function authorizeDiscordOperationAndRespond(input: {
  permissions: PermissionsRuntimeService;
  botName: string;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  actor: DiscordPermissionActorContext;
  client: Parameters<typeof postDiscordMessage>[0];
  onDeny: () => Promise<void>;
  onRequireApprovalNotice?: (message: string) => Promise<void>;
  pendingApprovalText?: string;
  approvalPresentation?: ApprovalPresentationMode;
  resolveApprovalThreadId?: (approvalId: string) => Promise<string | undefined>;
}): Promise<boolean> {
  const authorization = await authorizeDiscordOperation({
    permissions: input.permissions,
    action: input.action,
    summary: input.summary,
    operation: input.operation,
    userId: input.actor.userId,
    channelId: input.actor.channelId,
    ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
    ...(input.actor.guildId ? { guildId: input.actor.guildId } : {}),
    roleIds: extractDiscordRoleIds(input.actor.member),
  });
  if (authorization.status === 'deny') {
    await input.onDeny();
    return false;
  }
  if (authorization.status === 'require_approval') {
    const approvalPresentation = input.approvalPresentation ?? 'default';
    if (approvalPresentation === 'approval_only') {
      const resolvedThreadId = input.actor.threadId
        ? input.actor.threadId
        : input.resolveApprovalThreadId
          ? await input.resolveApprovalThreadId(authorization.approval.id)
          : undefined;
      let approvalThreadId = resolvedThreadId;
      if (!input.actor.threadId && resolvedThreadId) {
        const reassigned = await input.permissions.assignApprovalContextIfPending({
          approvalId: authorization.approval.id,
          channelId: resolvedThreadId,
          threadId: resolvedThreadId,
          updateOperationRouting: false,
        });
        if (!reassigned) {
          logger.warn(
            {
              approvalId: authorization.approval.id,
              channelId: input.actor.channelId,
              threadId: resolvedThreadId,
            },
            'Failed to reassign Discord approval thread context; posting approval without thread',
          );
          approvalThreadId = undefined;
        }
      }
      await postDiscordApprovalMessage({
        client: input.client,
        channelId: input.actor.channelId,
        ...(approvalThreadId ? { threadId: approvalThreadId } : {}),
        approval: authorization.approval,
      });
      return false;
    }
    if (input.onRequireApprovalNotice) {
      await input.onRequireApprovalNotice(input.pendingApprovalText ?? defaultPendingApprovalText);
    }
    const requestSummary = resolveRequestSummaryFromOperation(input.operation, input.summary);
    const requestContext = await postDiscordJobRequestAndResolveThread({
      client: input.client,
      botName: input.botName,
      channelId: input.actor.channelId,
      ...(input.actor.threadId ? { existingThreadId: input.actor.threadId } : {}),
      requestSummary,
      approvalId: authorization.approval.id,
      ...(input.operation.kind === 'enqueueJob' ? { jobId: input.operation.job.jobId } : {}),
      ...(input.operation.kind === 'enqueueJob' && input.operation.job.contextFiles?.length
        ? { contextFiles: input.operation.job.contextFiles }
        : {}),
    });
    let approvalThreadId = requestContext.threadId;
    if (!input.actor.threadId && requestContext.threadId) {
      const reassigned = await input.permissions.assignApprovalContextIfPending({
        approvalId: authorization.approval.id,
        channelId: requestContext.threadId,
        threadId: requestContext.threadId,
        ...(input.operation.kind === 'enqueueJob' && requestContext.requestMessageId
          ? { requestMessageId: requestContext.requestMessageId }
          : {}),
      });
      if (!reassigned) {
        logger.warn(
          {
            approvalId: authorization.approval.id,
            channelId: input.actor.channelId,
            threadId: requestContext.threadId,
          },
          'Failed to reassign Discord approval thread context; posting approval without thread',
        );
        approvalThreadId = undefined;
      }
    } else if (
      input.operation.kind === 'enqueueJob' &&
      requestContext.requestMessageId &&
      input.actor.threadId
    ) {
      await input.permissions.assignApprovalContextIfPending({
        approvalId: authorization.approval.id,
        requestMessageId: requestContext.requestMessageId,
      });
    }
    await postDiscordApprovalMessage({
      client: input.client,
      channelId: input.actor.channelId,
      ...(approvalThreadId ? { threadId: approvalThreadId } : {}),
      approval: authorization.approval,
    });
    return false;
  }
  return true;
}

export function toApprovalResolutionAction(
  action: DiscordApprovalAction,
): 'approval.grant' | 'approval.deny' | 'approval.cancel' {
  switch (action) {
    case 'approvalApprove':
      return 'approval.grant';
    case 'approvalDeny':
      return 'approval.deny';
    case 'approvalCancel':
      return 'approval.cancel';
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported approval action: ${String(exhaustive)}`);
    }
  }
}
