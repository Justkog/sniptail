import { describe, expect, it, vi } from 'vitest';
import {
  buildPromptForJob,
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
