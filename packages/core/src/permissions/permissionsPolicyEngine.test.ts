import { describe, expect, it } from 'vitest';
import {
  evaluatePermissionDecision,
  explainPermissionDecision,
} from './permissionsPolicyEngine.js';
import type { PermissionsConfig } from './permissionsPolicyTypes.js';

const config: PermissionsConfig = {
  defaultEffect: 'allow',
  approvalTtlSeconds: 86_400,
  groupCacheTtlSeconds: 60,
  rules: [
    {
      id: 'deny-clear',
      effect: 'deny',
      actions: ['jobs.clear'],
      subjects: [{ kind: 'user', userId: 'U_DENY' }],
    },
    {
      id: 'approve-clear-before',
      effect: 'require_approval',
      actions: ['jobs.clearBefore'],
      subjects: [{ kind: 'user', userId: '*' }],
      approverSubjects: [{ kind: 'group', provider: 'slack', groupId: 'S_APPROVERS' }],
    },
  ],
};

describe('permissionsPolicyEngine', () => {
  it('applies first matching rule', () => {
    const decision = evaluatePermissionDecision({
      config,
      actor: {
        provider: 'slack',
        userId: 'U_DENY',
        groupIds: [],
      },
      context: {
        provider: 'slack',
        channelId: 'C1',
      },
      action: 'jobs.clear',
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('deny-clear');
  });

  it('matches group-based approval rules', () => {
    const decision = evaluatePermissionDecision({
      config,
      actor: {
        provider: 'slack',
        userId: 'U1',
        groupIds: ['S_APPROVERS'],
      },
      context: {
        provider: 'slack',
        channelId: 'C1',
      },
      action: 'jobs.clearBefore',
    });

    expect(decision.effect).toBe('require_approval');
    expect(decision.approverSubjects).toEqual([
      { kind: 'group', provider: 'slack', groupId: 'S_APPROVERS' },
    ]);
  });

  it('falls back to default effect', () => {
    const decision = evaluatePermissionDecision({
      config,
      actor: {
        provider: 'discord',
        userId: 'U2',
        groupIds: [],
      },
      context: {
        provider: 'discord',
        channelId: 'D1',
      },
      action: 'jobs.ask',
    });

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBeUndefined();
  });

  it('supports jobs.explore action matching', () => {
    const decision = evaluatePermissionDecision({
      config,
      actor: {
        provider: 'discord',
        userId: 'U2',
        groupIds: [],
      },
      context: {
        provider: 'discord',
        channelId: 'D1',
      },
      action: 'jobs.explore',
    });

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBeUndefined();
  });

  it('uses defaultApproverSubjects when no rules match and defaultEffect=require_approval', () => {
    const requireApprovalConfig: PermissionsConfig = {
      defaultEffect: 'require_approval',
      defaultApproverSubjects: [{ kind: 'group', provider: 'slack', groupId: 'S_GLOBAL' }],
      defaultNotifySubjects: [{ kind: 'user', userId: 'U_NOTIFY' }],
      approvalTtlSeconds: 86_400,
      groupCacheTtlSeconds: 60,
      rules: [],
    };
    const decision = evaluatePermissionDecision({
      config: requireApprovalConfig,
      actor: { provider: 'slack', userId: 'U1', groupIds: [] },
      context: { provider: 'slack', channelId: 'C1' },
      action: 'jobs.ask',
    });

    expect(decision.effect).toBe('require_approval');
    expect(decision.approverSubjects).toEqual([
      { kind: 'group', provider: 'slack', groupId: 'S_GLOBAL' },
    ]);
    expect(decision.notifySubjects).toEqual([{ kind: 'user', userId: 'U_NOTIFY' }]);
  });

  it('explains the first matching rule', () => {
    const explanation = explainPermissionDecision({
      config,
      actor: {
        provider: 'slack',
        userId: 'U_DENY',
        groupIds: [],
      },
      context: {
        provider: 'slack',
        channelId: 'C1',
      },
      action: 'jobs.clear',
    });

    expect(explanation.decision.effect).toBe('deny');
    expect(explanation.decision.ruleId).toBe('deny-clear');
    expect(explanation.matchedRule).toBe('deny-clear');
    expect(explanation.trace).toEqual([
      {
        kind: 'rule',
        ruleId: 'deny-clear',
        effect: 'deny',
        status: 'matched',
        reasons: [],
      },
    ]);
  });

  it('explains default fallback when no rule matches', () => {
    const explanation = explainPermissionDecision({
      config,
      actor: {
        provider: 'discord',
        userId: 'U2',
        groupIds: [],
      },
      context: {
        provider: 'discord',
        channelId: 'D1',
      },
      action: 'jobs.ask',
    });

    expect(explanation.decision.effect).toBe('allow');
    expect(explanation.decision.ruleId).toBeUndefined();
    expect(explanation.matchedRule).toBe('default');
    expect(explanation.trace.at(-1)).toEqual({
      kind: 'default',
      effect: 'allow',
      status: 'matched',
      reasons: [],
    });
  });

  it('reports skipped reasons for action, provider, channel, and subject mismatches', () => {
    const explanation = explainPermissionDecision({
      config: {
        defaultEffect: 'allow',
        approvalTtlSeconds: 86_400,
        groupCacheTtlSeconds: 60,
        rules: [
          {
            id: 'specific-rule',
            effect: 'deny',
            actions: ['jobs.implement'],
            subjects: [{ kind: 'group', provider: 'slack', groupId: 'S_RELEASE' }],
            providers: ['slack'],
            channelIds: ['C_RELEASE'],
          },
        ],
      },
      actor: {
        provider: 'discord',
        userId: 'U1',
        groupIds: [],
      },
      context: {
        provider: 'discord',
        channelId: 'D1',
      },
      action: 'jobs.ask',
    });

    expect(explanation.trace[0]).toEqual({
      kind: 'rule',
      ruleId: 'specific-rule',
      effect: 'deny',
      status: 'skipped',
      reasons: ['action_mismatch', 'provider_mismatch', 'channel_mismatch', 'subject_mismatch'],
    });
  });
});
