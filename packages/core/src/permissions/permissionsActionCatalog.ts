export const PERMISSION_ACTIONS = [
  'jobs.ask',
  'jobs.plan',
  'jobs.implement',
  'jobs.review',
  'jobs.bootstrap',
  'jobs.answerQuestions',
  'jobs.clear',
  'jobs.clearBefore',
  'jobs.worktreeCommands',
  'status.codexUsage',
  'jobs.mention',
  'approval.grant',
  'approval.deny',
  'approval.cancel',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

const PERMISSION_ACTION_SET = new Set<string>(PERMISSION_ACTIONS);

export function isPermissionAction(value: string): value is PermissionAction {
  return PERMISSION_ACTION_SET.has(value);
}
