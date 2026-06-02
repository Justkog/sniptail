import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  loadBotPermissionsConfig: vi.fn(),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadBotPermissionsConfig: hoisted.loadBotPermissionsConfig,
}));

import type { PermissionsConfig } from '@sniptail/core/permissions/permissionsPolicyTypes.js';
import { formatPermissionsExplainPayload, handlePermissionsExplain } from './permissions.js';

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
      id: 'approve-implement',
      effect: 'require_approval',
      actions: ['jobs.implement'],
      subjects: [{ kind: 'group', provider: 'slack', groupId: 'S_ENGINEERS' }],
      approverSubjects: [{ kind: 'group', provider: 'slack', groupId: 'S_APPROVERS' }],
      notifySubjects: [{ kind: 'user', userId: 'U_NOTIFY' }],
    },
  ],
};

describe('permissions CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadBotPermissionsConfig.mockReturnValue(config);
  });

  it('formats an allow decision from the default policy', () => {
    const result = handlePermissionsExplain([
      '--action',
      'jobs.ask',
      '--provider',
      'discord',
      '--channel-id',
      'D1',
      '--user-id',
      'U1',
    ]);

    const output = formatPermissionsExplainPayload(result.payload);

    expect(result.asJson).toBe(false);
    expect(output).toContain('decision: allow');
    expect(output).toContain('matchedRule: default');
    expect(output).toContain('- matched default: allow');
  });

  it('formats a deny decision from a matching rule', () => {
    const result = handlePermissionsExplain([
      '--action',
      'jobs.clear',
      '--provider',
      'slack',
      '--channel-id',
      'C1',
      '--user-id',
      'U_DENY',
    ]);

    const output = formatPermissionsExplainPayload(result.payload);

    expect(output).toContain('decision: deny');
    expect(output).toContain('matchedRule: deny-clear');
    expect(output).toContain('- matched deny-clear: deny');
  });

  it('formats a require approval decision with approver and notify subjects', () => {
    const result = handlePermissionsExplain([
      '--action',
      'jobs.implement',
      '--provider',
      'slack',
      '--channel-id',
      'C1',
      '--user-id',
      'U1',
      '--group-id',
      'S_ENGINEERS',
    ]);

    const output = formatPermissionsExplainPayload(result.payload);

    expect(output).toContain('decision: require_approval');
    expect(output).toContain('matchedRule: approve-implement');
    expect(output).toContain('approverSubjects: slack:S_APPROVERS');
    expect(output).toContain('notifySubjects: user:U_NOTIFY');
  });

  it('returns JSON-ready payload fields and captures repeated options', () => {
    const result = handlePermissionsExplain([
      '--action',
      'jobs.run',
      '--provider',
      'slack',
      '--channel-id',
      'C1',
      '--user-id',
      'U1',
      '--group-id',
      'S_ENGINEERS',
      '--group-id',
      'S_RELEASE',
      '--repo',
      'my-api',
      '--repo',
      'payments',
      '--thread-id',
      'T1',
      '--workspace-id',
      'W1',
      '--json',
    ]);

    expect(result.asJson).toBe(true);
    expect(result.payload.command).toBe('permissions.explain');
    expect(result.payload.input.actor.groupIds).toEqual(['S_ENGINEERS', 'S_RELEASE']);
    expect(result.payload.input.context.repoKeys).toEqual(['my-api', 'payments']);
    expect(result.payload.input.context.threadId).toBe('T1');
    expect(result.payload.input.context.workspaceId).toBe('W1');
    expect(result.payload.decision.effect).toBe('allow');
  });

  it('rejects invalid action values', () => {
    expect(() =>
      handlePermissionsExplain([
        '--action',
        'jobs.nope',
        '--provider',
        'slack',
        '--channel-id',
        'C1',
        '--user-id',
        'U1',
      ]),
    ).toThrow('Invalid --action value: jobs.nope.');
  });

  it('rejects invalid provider values', () => {
    expect(() =>
      handlePermissionsExplain([
        '--action',
        'jobs.ask',
        '--provider',
        'matrix',
        '--channel-id',
        'C1',
        '--user-id',
        'U1',
      ]),
    ).toThrow('Invalid --provider value. Expected one of: slack, discord, telegram.');
  });

  it('rejects missing required arguments', () => {
    expect(() => handlePermissionsExplain(['--action', 'jobs.ask', '--provider', 'slack'])).toThrow(
      '--channel-id is required.',
    );
  });
});
