import type { PermissionAction } from './permissionsActionCatalog.js';
import type {
  PermissionActor,
  PermissionContext,
  PermissionDecision,
  PermissionRule,
  PermissionSubject,
  PermissionsConfig,
} from './permissionsPolicyTypes.js';

export type PermissionRuleTraceReason =
  | 'action_mismatch'
  | 'provider_mismatch'
  | 'channel_mismatch'
  | 'subject_mismatch';

export type PermissionRuleTraceEntry =
  | {
      kind: 'rule';
      ruleId: string;
      effect: PermissionRule['effect'];
      status: 'matched';
      reasons: [];
    }
  | {
      kind: 'rule';
      ruleId: string;
      effect: PermissionRule['effect'];
      status: 'skipped';
      reasons: PermissionRuleTraceReason[];
    }
  | {
      kind: 'default';
      effect: PermissionsConfig['defaultEffect'];
      status: 'matched';
      reasons: [];
    };

export type PermissionExplanation = {
  decision: PermissionDecision;
  matchedRule: string;
  trace: PermissionRuleTraceEntry[];
};

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

function traceRule(
  rule: PermissionRule,
  actor: PermissionActor,
  context: PermissionContext,
  action: PermissionAction,
): PermissionRuleTraceEntry {
  const reasons: PermissionRuleTraceReason[] = [];
  if (!rule.actions.includes(action)) {
    reasons.push('action_mismatch');
  }
  if (rule.providers?.length && !rule.providers.includes(context.provider)) {
    reasons.push('provider_mismatch');
  }
  if (rule.channelIds?.length && !rule.channelIds.includes(context.channelId)) {
    reasons.push('channel_mismatch');
  }
  if (rule.subjects?.length && !rule.subjects.some((subject) => matchesSubject(actor, subject))) {
    reasons.push('subject_mismatch');
  }
  if (!reasons.length) {
    return {
      kind: 'rule',
      ruleId: rule.id,
      effect: rule.effect,
      status: 'matched',
      reasons: [],
    };
  }
  return {
    kind: 'rule',
    ruleId: rule.id,
    effect: rule.effect,
    status: 'skipped',
    reasons,
  };
}

function decisionFromRule(action: PermissionAction, rule: PermissionRule): PermissionDecision {
  return {
    effect: rule.effect,
    action,
    ruleId: rule.id,
    approverSubjects: rule.approverSubjects ?? [],
    notifySubjects: rule.notifySubjects ?? rule.approverSubjects ?? [],
  };
}

function defaultDecision(config: PermissionsConfig, action: PermissionAction): PermissionDecision {
  const defaultApprovers = config.defaultApproverSubjects ?? [];
  return {
    effect: config.defaultEffect,
    action,
    approverSubjects: defaultApprovers,
    notifySubjects: config.defaultNotifySubjects ?? defaultApprovers,
  };
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
    return decisionFromRule(action, matchedRule);
  }
  return defaultDecision(config, action);
}

export function explainPermissionDecision(input: {
  config: PermissionsConfig;
  actor: PermissionActor;
  context: PermissionContext;
  action: PermissionAction;
}): PermissionExplanation {
  const { config, actor, context, action } = input;
  const trace: PermissionRuleTraceEntry[] = [];
  for (const rule of config.rules) {
    const entry = traceRule(rule, actor, context, action);
    trace.push(entry);
    if (entry.status === 'matched') {
      return {
        decision: decisionFromRule(action, rule),
        matchedRule: rule.id,
        trace,
      };
    }
  }

  trace.push({
    kind: 'default',
    effect: config.defaultEffect,
    status: 'matched',
    reasons: [],
  });
  return {
    decision: defaultDecision(config, action),
    matchedRule: 'default',
    trace,
  };
}
