import {
  buildAskPrompt,
  buildExplorePrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from './prompts/index.js';
import type { JobSpec, JobType } from '../types/job.js';

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

function continuationModeContract(type: JobType, sameMode: boolean, gitRef: string): string {
  if (sameMode) {
    return `Continue the existing ${type} task and preserve its established output contract.`;
  }

  switch (type) {
    case 'ASK':
      return 'Switch to ASK mode: answer directly with repository evidence, state unsupported conclusions, explain verification, and write artifacts/report.md.';
    case 'EXPLORE':
      return 'Switch to EXPLORE mode: present viable options, tradeoffs, risks, repository evidence, a recommendation, and write artifacts/report.md.';
    case 'IMPLEMENT':
      return 'Switch to IMPLEMENT mode: make only the requested minimal code changes, add tests only when explicitly requested, add docs when needed, and leave the repositories ready to commit.';
    case 'PLAN':
      return 'Switch to PLAN mode: inspect first, ask 1-3 blocking questions instead of writing a plan if intent is ambiguous, then write artifacts/plan.md with summary, assumptions, steps, files, verification, and risks.';
    case 'REVIEW':
      return `Switch to REVIEW mode: do not modify repositories; compare the current branch with base ref ${gitRef}, assess risks and recommendations, and write artifacts/report.md.`;
    case 'MENTION':
      return 'Switch to MENTION mode: reply concisely and use repository files only when the request clearly needs them.';
    case 'RUN':
      return 'Continue with the requested run action.';
    default:
      return assertNeverJobType(type);
  }
}

export function buildContinuationPromptForJob(input: {
  job: JobSpec;
  botName: string;
  previousJobType?: JobType;
  workDir: string;
  threadContext?: string;
  threadContextMode: 'delta' | 'full' | 'empty';
  lineageWarnings?: LineagePromptWarning[];
}): string {
  const {
    job,
    botName,
    previousJobType,
    workDir,
    threadContext,
    threadContextMode,
    lineageWarnings = [],
  } = input;
  const sameMode = previousJobType === job.type;
  const sections = [
    `You are ${botName}.`,
    continuationModeContract(job.type, sameMode, job.gitRef),
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
