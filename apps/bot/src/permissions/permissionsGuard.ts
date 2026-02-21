// TODO: Remove this compatibility facade after all call sites have been migrated.
export type {
  DiscordPermissionActorContext,
  SlackPermissionActorContext,
} from './permissionsGuardTypes.js';

export {
  authorizeSlackOperation,
  authorizeSlackOperationAndRespond,
  authorizeSlackPrecheck,
  authorizeSlackPrecheckAndRespond,
} from '../slack/permissions/slackPermissionGuards.js';

export {
  authorizeDiscordOperation,
  authorizeDiscordOperationAndRespond,
  authorizeDiscordPrecheck,
  authorizeDiscordPrecheckAndRespond,
  extractDiscordRoleIds,
  toApprovalResolutionAction,
} from '../discord/permissions/discordPermissionGuards.js';
