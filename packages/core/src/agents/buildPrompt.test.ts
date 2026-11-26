import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptForJob,
  buildContinuationPromptForJob,
  buildPromptForJobWithLineageWarnings,
  type LineagePromptWarning,
} from './buildPrompt.js';

vi.mock('./prompts/index.js', () => ({
  buildAskPrompt: vi.fn(() => 'ask prompt'),
  buildExplorePrompt: vi.fn(() => 'explore prompt'),
  buildImplementPrompt: vi.fn(() => 'implement prompt'),
  buildMentionPrompt: vi.fn(() => 'mention prompt'),
  buildPlanPrompt: vi.fn(() => 'plan prompt'),
  buildReviewPrompt: vi.fn(() => 'review prompt'),
}));

function buildJob(type: 'ASK' | 'EXPLORE' | 'IMPLEMENT' | 'PLAN' | 'REVIEW' | 'MENTION') {
  return {
    jobId: 'job-1',
    type,
    repoKeys: ['repo-1'],
    gitRef: 'main',
    requestText: 'test request',
    channel: {
      provider: 'slack' as const,
      channelId: 'C123',
      userId: 'U123',
    },
  };
}

describe('buildPromptForJobWithLineageWarnings', () => {
  it('preserves the base action prompt when no warnings are present', () => {
    const job = buildJob('EXPLORE');

    expect(buildPromptForJobWithLineageWarnings(job, 'sniptail', [])).toBe(
      buildPromptForJob(job, 'sniptail'),
    );
  });

  it('appends lineage warning details to the base action prompt', () => {
    const job = buildJob('EXPLORE');
    const warnings: LineagePromptWarning[] = [
      {
        repoKey: 'repo-1',
        originBranch: 'sniptail/job-root',
        previousTipSha: '1111111',
        currentTipSha: '2222222',
      },
    ];

    const prompt = buildPromptForJobWithLineageWarnings(job, 'sniptail', warnings);

    expect(prompt).toContain('explore prompt');
    expect(prompt).toContain('Lineage drift warning:');
    expect(prompt).toContain('Repo: repo-1');
    expect(prompt).toContain('Previous recorded SHA: 1111111');
    expect(prompt).toContain('Current branch SHA: 2222222');
  });

  it('appends local-only lineage fallback details to the base action prompt', () => {
    const job = buildJob('IMPLEMENT');
    const warnings: LineagePromptWarning[] = [
      {
        kind: 'local-only-fallback',
        repoKey: 'repo-1',
        originBranch: 'sniptail/explore-job',
        previousTipSha: '1111111',
        currentTipSha: '2222222',
        nextBranch: 'sniptail/implement-job',
      },
    ];

    const prompt = buildPromptForJobWithLineageWarnings(job, 'sniptail', warnings);

    expect(prompt).toContain('implement prompt');
    expect(prompt).toContain('Lineage resume warning:');
    expect(prompt).toContain('Previous lineage branch: sniptail/explore-job');
    expect(prompt).toContain('Previous recorded SHA: 1111111');
    expect(prompt).toContain('Cached branch SHA: 2222222');
    expect(prompt).toContain('New publish branch: sniptail/implement-job');
  });
});

describe('buildContinuationPromptForJob', () => {
  it('uses the existing mode contract for same-mode continuation turns', () => {
    const prompt = buildContinuationPromptForJob({
      job: buildJob('ASK'),
      botName: 'sniptail',
      previousJobType: 'ASK',
      workDir: '/tmp/job-root/job-2',
      threadContext: 'U2: only the new context',
      threadContextMode: 'delta',
    });

    expect(prompt).toContain('Continue the existing ASK task');
    expect(prompt).toContain('New channel messages since the previous provider turn:');
    expect(prompt).toContain('U2: only the new context');
    expect(prompt).not.toContain('ask prompt');
    expect(prompt.match(/working directory/g)).toHaveLength(1);
  });

  it('includes the new output contract for mode transitions', () => {
    const prompt = buildContinuationPromptForJob({
      job: buildJob('REVIEW'),
      botName: 'sniptail',
      previousJobType: 'IMPLEMENT',
      workDir: '/tmp/job-root/job-3',
      threadContextMode: 'empty',
    });

    expect(prompt).toContain('Switch to REVIEW mode');
    expect(prompt).toContain('compare the current branch with base ref main');
    expect(prompt).toContain('write artifacts/report.md');
    expect(prompt).not.toContain('New channel messages');
  });
});
