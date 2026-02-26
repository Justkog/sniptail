import {
  buildDiscordApprovalComponents,
  type DiscordApprovalAction,
} from '@sniptail/core/discord/components.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type { DeferredPermissionOperation } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { logger } from '@sniptail/core/logger.js';
import { isSendableTextChannel, postDiscordMessage } from '../helpers.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';
import type { DiscordPermissionActorContext } from '../../permissions/permissionsGuardTypes.js';
import { resolvePermissionsProviderCapabilities } from '../../permissions/permissionsProviderCapabilities.js';
import { resolveDiscordActorGroups } from './discordPermissionsActorGroups.js';

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

function buildDiscordJobRequestText(requestSummary: string): string {
  return `**Job request**\n\`\`\`\n${requestSummary}\n\`\`\``;
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
  channelId: string;
  existingThreadId?: string;
  requestSummary: string;
  approvalId: string;
}): Promise<string | undefined> {
  const text = buildDiscordJobRequestText(input.requestSummary);
  if (input.existingThreadId) {
    try {
      await postDiscordMessage(input.client, {
        channelId: input.channelId,
        threadId: input.existingThreadId,
        text,
      });
    } catch (err) {
      logger.warn(
        { err, channelId: input.channelId, threadId: input.existingThreadId },
        'Failed to post Discord job request in existing thread',
      );
    }
    return input.existingThreadId;
  }

  try {
    const channel = await input.client.channels.fetch(input.channelId);
    if (!channel?.isTextBased() || !isSendableTextChannel(channel)) {
      logger.warn({ channelId: input.channelId }, 'Discord channel is not sendable for approvals');
      return undefined;
    }
    const requestMessage = await channel.send({ content: text });
    const threadName = `sniptail approval ${input.approvalId}`.slice(0, 100);
    try {
      const thread = await requestMessage.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
      });
      return thread.id;
    } catch (err) {
      logger.warn({ err, channelId: input.channelId }, 'Failed to create Discord approval thread');
      return undefined;
    }
  } catch (err) {
    logger.warn({ err, channelId: input.channelId }, 'Failed to post Discord job request');
    return undefined;
  }
}

export async function authorizeDiscordOperationAndRespond(input: {
  permissions: PermissionsRuntimeService;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  actor: DiscordPermissionActorContext;
  client: Parameters<typeof postDiscordMessage>[0];
  onDeny: () => Promise<void>;
  onRequireApprovalNotice?: (message: string) => Promise<void>;
  pendingApprovalText?: string;
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
    if (input.onRequireApprovalNotice) {
      await input.onRequireApprovalNotice(input.pendingApprovalText ?? defaultPendingApprovalText);
    }
    const requestSummary = resolveRequestSummaryFromOperation(input.operation, input.summary);
    const requestThreadId = await postDiscordJobRequestAndResolveThread({
      client: input.client,
      channelId: input.actor.channelId,
      ...(input.actor.threadId ? { existingThreadId: input.actor.threadId } : {}),
      requestSummary,
      approvalId: authorization.approval.id,
    });
    let approvalThreadId = requestThreadId;
    if (!input.actor.threadId && requestThreadId) {
      const reassigned = await input.permissions.assignApprovalContextIfPending({
        approvalId: authorization.approval.id,
        channelId: requestThreadId,
        threadId: requestThreadId,
      });
      if (!reassigned) {
        logger.warn(
          {
            approvalId: authorization.approval.id,
            channelId: input.actor.channelId,
            threadId: requestThreadId,
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
