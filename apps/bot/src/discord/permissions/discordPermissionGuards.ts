import {
  buildDiscordApprovalComponents,
  type DiscordApprovalAction,
} from '@sniptail/core/discord/components.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type { DeferredPermissionOperation } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { postDiscordMessage } from '../helpers.js';
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
  actor: DiscordPermissionActorContext;
  approval: {
    text: string;
    components: ReturnType<typeof buildDiscordApprovalComponents>;
  };
}) {
  await postDiscordMessage(input.client, {
    channelId: input.actor.channelId,
    ...(input.actor.threadId ? { threadId: input.actor.threadId } : {}),
    text: input.approval.text,
    components: input.approval.components,
  });
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
    await postDiscordApprovalMessage({
      client: input.client,
      actor: input.actor,
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
