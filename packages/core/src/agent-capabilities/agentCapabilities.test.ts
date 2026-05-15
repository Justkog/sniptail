import { describe, expect, it } from 'vitest';
import {
  aggregateAgentCapabilities,
  chooseLeastActiveWorker,
  findEligibleAgentWorkers,
  isProfileConflicted,
  isWorkspaceAmbiguous,
  type EligibleAgentWorker,
  type WorkerAgentCapability,
} from './agentCapabilities.js';

const NOW = new Date('2026-05-15T12:00:00.000Z');

function buildWorker(
  overrides: Partial<WorkerAgentCapability> & Pick<WorkerAgentCapability, 'workerId'>,
): WorkerAgentCapability {
  return {
    workerId: overrides.workerId,
    enabled: true,
    workspaces: [
      {
        key: 'snatch',
        label: 'Snatch',
        description: 'Main checkout',
      },
    ],
    profiles: [
      {
        key: 'build',
        provider: 'codex',
        profile: 'default',
        label: 'Build',
        description: 'Default Codex profile',
      },
    ],
    startedAt: '2026-05-15T11:00:00.000Z',
    lastSeenAt: '2026-05-15T11:59:50.000Z',
    ...overrides,
  };
}

function buildEligibleWorker(
  overrides: Partial<EligibleAgentWorker> & Pick<EligibleAgentWorker, 'workerId' | 'workspace' | 'profile'>,
): EligibleAgentWorker {
  return {
    workerId: overrides.workerId,
    activeSessionCount: 0,
    workspace: overrides.workspace,
    profile: overrides.profile,
    ...overrides,
  };
}

describe('aggregateAgentCapabilities', () => {
  it('aggregates compatible duplicate workspace and profile keys', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [buildWorker({ workerId: 'worker-b' }), buildWorker({ workerId: 'worker-a' })],
    });

    expect(aggregated.liveWorkers.map((worker) => worker.workerId)).toEqual([
      'worker-a',
      'worker-b',
    ]);
    expect(aggregated.workspaces).toEqual([
      {
        key: 'snatch',
        status: 'available',
        label: 'Snatch',
        description: 'Main checkout',
        workerIds: ['worker-a', 'worker-b'],
        workers: [
          {
            workerId: 'worker-a',
            key: 'snatch',
            label: 'Snatch',
            description: 'Main checkout',
          },
          {
            workerId: 'worker-b',
            key: 'snatch',
            label: 'Snatch',
            description: 'Main checkout',
          },
        ],
      },
    ]);
    expect(aggregated.profiles).toEqual([
      {
        key: 'build',
        status: 'available',
        provider: 'codex',
        profile: 'default',
        label: 'Build',
        description: 'Default Codex profile',
        workerIds: ['worker-a', 'worker-b'],
        workers: [
          {
            workerId: 'worker-a',
            key: 'build',
            provider: 'codex',
            profile: 'default',
            label: 'Build',
            description: 'Default Codex profile',
          },
          {
            workerId: 'worker-b',
            key: 'build',
            provider: 'codex',
            profile: 'default',
            label: 'Build',
            description: 'Default Codex profile',
          },
        ],
      },
    ]);
  });

  it('marks workspace metadata mismatches as ambiguous and preserves worker details', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({ workerId: 'worker-a' }),
        buildWorker({
          workerId: 'worker-b',
          workerLabel: 'Worker B',
          workspaces: [
            {
              key: 'snatch',
              label: 'Snatch Alt',
              description: 'Alternate checkout',
            },
          ],
        }),
      ],
    });

    expect(isWorkspaceAmbiguous(aggregated.workspaces[0])).toBe(true);
    expect(aggregated.workspaces[0]).toEqual({
      key: 'snatch',
      status: 'ambiguous',
      workerIds: ['worker-a', 'worker-b'],
      workers: [
        {
          workerId: 'worker-a',
          key: 'snatch',
          label: 'Snatch',
          description: 'Main checkout',
        },
        {
          workerId: 'worker-b',
          workerLabel: 'Worker B',
          key: 'snatch',
          label: 'Snatch Alt',
          description: 'Alternate checkout',
        },
      ],
    });
  });

  it('marks incompatible duplicate profiles as conflicted', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({ workerId: 'worker-a' }),
        buildWorker({
          workerId: 'worker-b',
          profiles: [
            {
              key: 'build',
              provider: 'codex',
              profile: 'default',
              model: 'gpt-5.5',
              label: 'Build',
              description: 'Default Codex profile',
            },
          ],
        }),
      ],
    });

    expect(isProfileConflicted(aggregated.profiles[0])).toBe(true);
    expect(aggregated.profiles[0]).toEqual({
      key: 'build',
      status: 'conflicted',
      workerIds: ['worker-a', 'worker-b'],
      workers: [
        {
          workerId: 'worker-a',
          key: 'build',
          provider: 'codex',
          profile: 'default',
          label: 'Build',
          description: 'Default Codex profile',
        },
        {
          workerId: 'worker-b',
          key: 'build',
          provider: 'codex',
          profile: 'default',
          model: 'gpt-5.5',
          label: 'Build',
          description: 'Default Codex profile',
        },
      ],
    });
  });

  it('excludes stale and disabled workers from logical choices', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({ workerId: 'worker-live' }),
        buildWorker({
          workerId: 'worker-stale',
          lastSeenAt: '2026-05-15T11:59:00.000Z',
        }),
        buildWorker({
          workerId: 'worker-disabled',
          enabled: false,
        }),
      ],
    });

    expect(aggregated.liveWorkers.map((worker) => worker.workerId)).toEqual(['worker-live']);
    expect(aggregated.staleWorkers.map((worker) => worker.workerId)).toEqual(['worker-stale']);
    expect(aggregated.disabledWorkers.map((worker) => worker.workerId)).toEqual([
      'worker-disabled',
    ]);
    expect(aggregated.workspaces[0]?.workerIds).toEqual(['worker-live']);
    expect(aggregated.profiles[0]?.workerIds).toEqual(['worker-live']);
  });
});

describe('findEligibleAgentWorkers', () => {
  it('filters out stale workers and workers at max active sessions', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({
          workerId: 'worker-a',
          maxActiveSessions: 1,
        }),
        buildWorker({
          workerId: 'worker-b',
          maxActiveSessions: 2,
        }),
        buildWorker({
          workerId: 'worker-c',
          lastSeenAt: '2026-05-15T11:58:00.000Z',
          maxActiveSessions: 10,
        }),
      ],
    });

    expect(
      findEligibleAgentWorkers({
        aggregated,
        workspaceKey: 'snatch',
        profileKey: 'build',
        activeSessionCounts: {
          'worker-a': 1,
          'worker-b': 1,
          'worker-c': 0,
        },
      }),
    ).toEqual([
      {
        workerId: 'worker-b',
        activeSessionCount: 1,
        maxActiveSessions: 2,
        remainingCapacity: 1,
        workspace: {
          workerId: 'worker-b',
          key: 'snatch',
          label: 'Snatch',
          description: 'Main checkout',
        },
        profile: {
          workerId: 'worker-b',
          key: 'build',
          provider: 'codex',
          profile: 'default',
          label: 'Build',
          description: 'Default Codex profile',
        },
      },
    ]);
  });

  it('still returns eligible workers for ambiguous workspaces', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({ workerId: 'worker-a' }),
        buildWorker({
          workerId: 'worker-b',
          workspaces: [
            {
              key: 'snatch',
              label: 'Snatch Alt',
              description: 'Alternate checkout',
            },
          ],
        }),
      ],
    });

    expect(
      findEligibleAgentWorkers({
        aggregated,
        workspaceKey: 'snatch',
        profileKey: 'build',
      }).map((worker) => worker.workerId),
    ).toEqual(['worker-a', 'worker-b']);
  });

  it('returns no eligible workers when the profile key is conflicted', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [
        buildWorker({ workerId: 'worker-a' }),
        buildWorker({
          workerId: 'worker-b',
          profiles: [
            {
              key: 'build',
              provider: 'codex',
              profile: 'alternate',
              label: 'Build',
              description: 'Different profile',
            },
          ],
        }),
      ],
    });

    expect(
      findEligibleAgentWorkers({
        aggregated,
        workspaceKey: 'snatch',
        profileKey: 'build',
      }),
    ).toEqual([]);
  });

  it('does not cap workers when maxActiveSessions is absent', () => {
    const aggregated = aggregateAgentCapabilities({
      now: NOW,
      capabilities: [buildWorker({ workerId: 'worker-a' })],
    });

    expect(
      findEligibleAgentWorkers({
        aggregated,
        workspaceKey: 'snatch',
        profileKey: 'build',
        activeSessionCounts: {
          'worker-a': 99,
        },
      }),
    ).toEqual([
      {
        workerId: 'worker-a',
        activeSessionCount: 99,
        workspace: {
          workerId: 'worker-a',
          key: 'snatch',
          label: 'Snatch',
          description: 'Main checkout',
        },
        profile: {
          workerId: 'worker-a',
          key: 'build',
          provider: 'codex',
          profile: 'default',
          label: 'Build',
          description: 'Default Codex profile',
        },
      },
    ]);
  });
});

describe('chooseLeastActiveWorker', () => {
  it('chooses the lowest active session count and breaks ties by worker id', () => {
    const workspace = {
      workerId: 'worker-z',
      key: 'snatch',
    };
    const profile = {
      workerId: 'worker-z',
      key: 'build',
      provider: 'codex' as const,
    };

    expect(
      chooseLeastActiveWorker([
        buildEligibleWorker({
          workerId: 'worker-b',
          activeSessionCount: 2,
          workspace: { ...workspace, workerId: 'worker-b' },
          profile: { ...profile, workerId: 'worker-b' },
        }),
        buildEligibleWorker({
          workerId: 'worker-a',
          activeSessionCount: 1,
          workspace: { ...workspace, workerId: 'worker-a' },
          profile: { ...profile, workerId: 'worker-a' },
        }),
        buildEligibleWorker({
          workerId: 'worker-c',
          activeSessionCount: 1,
          workspace: { ...workspace, workerId: 'worker-c' },
          profile: { ...profile, workerId: 'worker-c' },
        }),
      ]),
    ).toMatchObject({
      workerId: 'worker-a',
      activeSessionCount: 1,
    });
  });
});
