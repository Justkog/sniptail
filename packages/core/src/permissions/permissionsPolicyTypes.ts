import type { ChannelProvider } from '../types/channel.js';
import type { PermissionAction } from './permissionsActionCatalog.js';

export type PermissionEffect = 'allow' | 'deny' | 'require_approval';

export type PermissionSubject =
  | {
      kind: 'user';
      // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
      userId: string | '*';
    }
  | {
      kind: 'group';
      provider: 'slack' | 'discord';
      groupId: string;
    };

export type PermissionRule = {
  id: string;
  effect: PermissionEffect;
  actions: PermissionAction[];
  subjects?: PermissionSubject[];
  approverSubjects?: PermissionSubject[];
  notifySubjects?: PermissionSubject[];
  providers?: ChannelProvider[];
  channelIds?: string[];
};

export type PermissionsConfig = {
  defaultEffect: PermissionEffect;
  approvalTtlSeconds: number;
  groupCacheTtlSeconds: number;
  rules: PermissionRule[];
};

export type PermissionActor = {
  provider: ChannelProvider;
  userId: string;
  groupIds: string[];
};

export type PermissionContext = {
  provider: ChannelProvider;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  guildId?: string;
  repoKeys?: string[];
};

export type PermissionDecision = {
  effect: PermissionEffect;
  action: PermissionAction;
  ruleId?: string;
  approverSubjects: PermissionSubject[];
  notifySubjects: PermissionSubject[];
};
