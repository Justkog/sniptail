import {
  buildAskPrompt,
  buildExplorePrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from '../codex/prompts.js';
import type { JobSpec } from '../types/job.js';

export type LineagePromptWarning = {
  repoKey: string;
  originBranch: string;
  previousTipSha: string;
  currentTipSha: string;
};

function assertNeverJobType(jobType: never): never {
  throw new Error(`Unsupported job type: ${String(jobType)}`);
}

export function buildPromptForJob(job: JobSpec, botName: string): string {
  switch (job.type) {
    case 'ASK':
      return buildAskPrompt(job, botName);
    case 'IMPLEMENT':
      return buildImplementPrompt(job, botName);
    case 'EXPLORE':
      return buildExplorePrompt(job, botName);
    case 'PLAN':
      return buildPlanPrompt(job, botName);
    case 'REVIEW':
      return buildReviewPrompt(job, botName);
    case 'MENTION':
      return buildMentionPrompt(job, botName);
    default:
      return assertNeverJobType(job.type as never);
  }
}

export function buildPromptForJobWithLineageWarnings(
  job: JobSpec,
  botName: string,
  warnings: LineagePromptWarning[],
): string {
  const basePrompt = buildPromptForJob(job, botName);
  if (warnings.length === 0) {
    return basePrompt;
  }

  const renderedWarnings = warnings
    .map((warning) =>
      [
        `- Repo: ${warning.repoKey}`,
        `  Branch: ${warning.originBranch}`,
        `  Previous recorded SHA: ${warning.previousTipSha}`,
        `  Current branch SHA: ${warning.currentTipSha}`,
      ].join('\n'),
    )
    .join('\n');

  return `${basePrompt}

Lineage drift warning:
The lineage branch moved since the previously recorded tip for this resumed job.
Inspect the changes since the previous recorded SHA before proceeding because the code may have changed.

${renderedWarnings}`;
}
