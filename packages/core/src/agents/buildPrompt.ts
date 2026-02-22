import {
  buildAskPrompt,
  buildExplorePrompt,
  buildImplementPrompt,
  buildMentionPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from '../codex/prompts.js';
import type { JobSpec } from '../types/job.js';

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
      return assertNeverJobType(job.type);
  }
}
