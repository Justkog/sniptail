import { describe, expect, it } from 'vitest';
import { resolveWorkerChannelAdapter } from './workerChannelAdapters.js';

describe('worker channel adapters', () => {
  it('renders Slack completion messages with blocks', () => {
    const adapter = resolveWorkerChannelAdapter('slack');
    const rendered = adapter.renderCompletionMessage({
      botName: 'Sniptail',
      text: 'done',
      jobId: 'job-1',
      openQuestions: ['question'],
    });

    expect(adapter.capabilities.richTextBlocks).toBe(true);
    expect(rendered.options?.blocks).toBeDefined();
    expect(rendered.options?.components).toBeUndefined();
  });

  it('renders Discord completion messages with components', () => {
    const adapter = resolveWorkerChannelAdapter('discord');
    const rendered = adapter.renderCompletionMessage({
      botName: 'Sniptail',
      text: 'done',
      jobId: 'job-2',
      includeReviewFromJob: true,
    });

    expect(adapter.capabilities.richComponents).toBe(true);
    expect(rendered.options?.components).toBeDefined();
    expect(rendered.options?.blocks).toBeUndefined();
  });

  it('falls back to generic adapter for unknown providers', () => {
    const adapter = resolveWorkerChannelAdapter('http');
    const rendered = adapter.renderCompletionMessage({
      botName: 'Sniptail',
      text: 'done',
      jobId: 'job-3',
    });

    expect(rendered).toEqual({ text: 'done' });
  });
});
