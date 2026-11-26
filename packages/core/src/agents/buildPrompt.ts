import {
  buildAskPrompt,
  buildExplorePrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from './prompts/index.js';
import type { JobSpec, JobType } from '../types/job.js';
import { toSlackCommandPrefix } from '../utils/slack.js';

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
  const warningText = buildLineageWarningSections(warnings).join('\n\n');
  return warningText ? `${basePrompt}\n\n${warningText}` : basePrompt;
}

function buildLineageWarningSections(warnings: LineagePromptWarning[]): string[] {
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

  return sections;
}

function renderLineageWarnings(warnings: LineagePromptWarning[]): string {
  return buildLineageWarningSections(warnings).join('\n\n');
}

function continuationModeContract(type: JobType, botName: string, gitRef: string): string {
  switch (type) {
    case 'ASK':
      return 'ASK mode: treat repository contents as the source of truth. Do not modify repo files; only write artifacts/report.md. Answer directly with evidence, state what is unsupported, and explain how to verify.';
    case 'EXPLORE':
      return 'EXPLORE mode: treat repository contents as the source of truth. Do not modify repo files; only write artifacts/report.md. Present viable options, tradeoffs, risks, repository evidence, and a concrete recommendation without forcing a strict plan format.';
    case 'IMPLEMENT':
      return 'IMPLEMENT mode: implement the requested changes with minimal diffs, add tests only when explicitly requested, add docs when needed, and leave the repositories ready to commit.';
    case 'PLAN':
      return 'PLAN mode: treat repository contents as the source of truth. Do not modify repo files; only write artifacts/plan.md. If intent is ambiguous or required choices are unresolved, ask 1-3 focused questions in a numbered list only, then stop without plan content. Otherwise write one unified plan covering summary, assumptions, steps, files, verification, risks, and mitigations.';
    case 'REVIEW':
      return `REVIEW mode: do not modify repo files; only write artifacts/report.md. Compare the current branch with base ref ${gitRef}; note if a branch or diff is absent, assess risks and recommendations, and cite relevant files or symbols.`;
    case 'MENTION': {
      const commandPrefix = toSlackCommandPrefix(botName);
      return `MENTION mode: reply in a friendly, non-technical way by default and keep it concise. Use repository files only when clearly needed; otherwise answer from general knowledge. If the user asks what you can do, mention /${commandPrefix}-ask, /${commandPrefix}-explore, /${commandPrefix}-implement, and /${commandPrefix}-usage.`;
    }
    case 'RUN':
      return 'Continue with the requested run action.';
    default:
      return assertNeverJobType(type);
  }
}

export function buildContinuationPromptForJob(input: {
  job: JobSpec;
  botName: string;
  workDir: string;
  threadContext?: string;
  threadContextMode: 'delta' | 'full' | 'empty';
  lineageWarnings?: LineagePromptWarning[];
}): string {
  const { job, botName, workDir, threadContext, threadContextMode, lineageWarnings = [] } = input;
  const sections = [
    `You are ${botName}.`,
    continuationModeContract(job.type, botName, job.gitRef),
    `Use this working directory for the current turn: ${workDir}`,
  ];

  if (job.repoKeys.length) {
    sections.push(
      [
        'Repositories are located under the current job root:',
        ...job.repoKeys.map((repoKey) => `- ${repoKey}: repos/${repoKey}`),
      ].join('\n'),
    );
  }
  if (threadContext) {
    sections.push(
      [
        threadContextMode === 'delta'
          ? 'New channel messages since the previous provider turn:'
          : 'Channel context not previously recorded in this provider session:',
        threadContext,
      ].join('\n'),
    );
  }
  const warnings = renderLineageWarnings(lineageWarnings);
  if (warnings) sections.push(warnings);
  sections.push('Inspect the job root context/manifest.json and any relevant new context files.');
  sections.push(`Request: ${job.requestText}`);
  return sections.join('\n\n');
}
