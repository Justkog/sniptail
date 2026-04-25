import {
  buildAskPrompt,
  buildExplorePrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from './prompts/index.js';
import type { JobSpec } from '../types/job.js';

type PromptBuildOptions = {
  mentionPersonality?: string;
};

export type LineagePromptWarning =
  | {
      kind?: 'drift';
      repoKey: string;
      originBranch: string;
      previousTipSha: string;
      currentTipSha: string;
    }
  | {
      kind: 'local-only-fallback';
      repoKey: string;
      originBranch: string;
      previousTipSha: string;
      currentTipSha: string;
      nextBranch: string;
    };

function assertNeverJobType(jobType: never): never {
  throw new Error(`Unsupported job type: ${String(jobType)}`);
}

export function buildPromptForJob(job: JobSpec, botName: string, options: PromptBuildOptions = {}): string {
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
      return buildMentionPrompt(job, botName, options.mentionPersonality);
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

  const driftWarnings = warnings.filter((warning) => warning.kind !== 'local-only-fallback');
  const localOnlyWarnings = warnings.filter((warning) => warning.kind === 'local-only-fallback');
  const sections: string[] = [];

  if (driftWarnings.length > 0) {
    const renderedWarnings = driftWarnings
      .map((warning) =>
        [
          `- Repo: ${warning.repoKey}`,
          `  Branch: ${warning.originBranch}`,
          `  Previous recorded SHA: ${warning.previousTipSha}`,
          `  Current branch SHA: ${warning.currentTipSha}`,
        ].join('\n'),
      )
      .join('\n');
    sections.push(`Lineage drift warning:
The lineage branch moved since the previously recorded tip for this resumed job.
Inspect the changes since the previously recorded SHA before proceeding because the code may have changed.

${renderedWarnings}`);
  }

  if (localOnlyWarnings.length > 0) {
    const renderedWarnings = localOnlyWarnings
      .map((warning) =>
        [
          `- Repo: ${warning.repoKey}`,
          `  Previous lineage branch: ${warning.originBranch}`,
          `  Previous recorded SHA: ${warning.previousTipSha}`,
          `  Cached branch SHA: ${warning.currentTipSha}`,
          `  New publish branch: ${warning.nextBranch}`,
        ].join('\n'),
      )
      .join('\n');
    sections.push(`Lineage resume warning:
The previous lineage branch is only available in the worker cache for this resumed job.
Inspect the cached tip before proceeding because the remote lineage branch no longer exists.
Any new commits from this run will be published to a fresh branch.

${renderedWarnings}`);
  }

  return `${basePrompt}

${sections.join('\n\n')}`;
}
