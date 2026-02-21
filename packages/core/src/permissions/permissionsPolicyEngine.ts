import type { PermissionAction } from './permissionsActionCatalog.js';
import type {
  PermissionActor,
  PermissionContext,
  PermissionDecision,
  PermissionRule,
  PermissionSubject,
  PermissionsConfig,
} from './permissionsPolicyTypes.js';

function matchesSubject(actor: PermissionActor, subject: PermissionSubject): boolean {
  if (subject.kind === 'user') {
    return subject.userId === '*' || actor.userId === subject.userId;
  }
  if (subject.provider !== actor.provider) {
    return false;
  }
  return actor.groupIds.includes(subject.groupId);
}

function matchesRule(
  rule: PermissionRule,
  actor: PermissionActor,
  context: PermissionContext,
  action: PermissionAction,
): boolean {
  if (!rule.actions.includes(action)) {
    return false;
  }
  if (rule.providers?.length && !rule.providers.includes(context.provider)) {
    return false;
  }
  if (rule.channelIds?.length && !rule.channelIds.includes(context.channelId)) {
    return false;
  }
  if (rule.subjects?.length && !rule.subjects.some((subject) => matchesSubject(actor, subject))) {
    return false;
  }
  return true;
}

export function evaluatePermissionDecision(input: {
  config: PermissionsConfig;
  actor: PermissionActor;
  context: PermissionContext;
  action: PermissionAction;
}): PermissionDecision {
  const { config, actor, context, action } = input;
  const matchedRule = config.rules.find((rule) => matchesRule(rule, actor, context, action));
  if (matchedRule) {
    return {
      effect: matchedRule.effect,
      action,
      ruleId: matchedRule.id,
      approverSubjects: matchedRule.approverSubjects ?? [],
      notifySubjects: matchedRule.notifySubjects ?? matchedRule.approverSubjects ?? [],
    };
  }
  return {
    effect: config.defaultEffect,
    action,
    approverSubjects: [],
    notifySubjects: [],
  };
}
