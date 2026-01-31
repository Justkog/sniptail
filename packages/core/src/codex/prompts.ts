import Handlebars from 'handlebars';
import type { JobSpec } from '../types/job.js';
import { toSlackCommandPrefix } from '../utils/slack.js';
import askPromptTemplateSource from './prompts/ask.md?raw';
import planPromptTemplateSource from './prompts/plan.md?raw';
import implementPromptTemplateSource from './prompts/implement.md?raw';
import mentionPromptTemplateSource from './prompts/mention.md?raw';
import reviewPromptTemplateSource from './prompts/review.md?raw';

const askPromptTemplate = Handlebars.compile(askPromptTemplateSource.trimEnd());
const implementPromptTemplate = Handlebars.compile(implementPromptTemplateSource.trimEnd());
const mentionPromptTemplate = Handlebars.compile(mentionPromptTemplateSource.trimEnd());
const planPromptTemplate = Handlebars.compile(planPromptTemplateSource.trimEnd());
const reviewPromptTemplate = Handlebars.compile(reviewPromptTemplateSource.trimEnd());

export function buildAskPrompt(job: JobSpec, botName: string): string {
  return askPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
    threadContext: job.threadContext,
  });
}

export function buildImplementPrompt(job: JobSpec, botName: string): string {
  return implementPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
    threadContext: job.threadContext,
  });
}

export function buildPlanPrompt(job: JobSpec, botName: string): string {
  return planPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
    threadContext: job.threadContext,
  });
}

export function buildReviewPrompt(job: JobSpec, botName: string): string {
  return reviewPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
    threadContext: job.threadContext,
    gitRef: job.gitRef,
  });
}

export function buildMentionPrompt(job: JobSpec, botName: string): string {
  return mentionPromptTemplate({
    botName,
    commandPrefix: toSlackCommandPrefix(botName),
    requestText: job.requestText,
    threadContext: job.threadContext,
  });
}
