import Handlebars from 'handlebars';
import type { JobSpec } from '../types/job.js';
import { toSlackCommandPrefix } from '../utils/slack.js';
import askPromptTemplateSource from './prompts/ask.md?raw';
import implementPromptTemplateSource from './prompts/implement.md?raw';
import mentionPromptTemplateSource from './prompts/mention.md?raw';

const askPromptTemplate = Handlebars.compile(askPromptTemplateSource.trimEnd());
const implementPromptTemplate = Handlebars.compile(implementPromptTemplateSource.trimEnd());
const mentionPromptTemplate = Handlebars.compile(mentionPromptTemplateSource.trimEnd());

export function buildAskPrompt(job: JobSpec, botName: string): string {
  return askPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
  });
}

export function buildImplementPrompt(job: JobSpec, botName: string): string {
  return implementPromptTemplate({
    botName,
    repoKeys: job.repoKeys,
    requestText: job.requestText,
  });
}

export function buildMentionPrompt(job: JobSpec, botName: string): string {
  return mentionPromptTemplate({
    botName,
    commandPrefix: toSlackCommandPrefix(botName),
    requestText: job.requestText,
  });
}
