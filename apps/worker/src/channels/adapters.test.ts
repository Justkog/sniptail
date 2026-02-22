import { describe, expect, it } from 'vitest';
import { resolveWorkerChannelAdapter } from './workerChannelAdapters.js';

describe('worker channel adapters', () => {
  it('renders Slack completion messages with blocks', () => {
    const adapter = resolveWorkerChannelAdapter('slack');
    const rendered = adapter.renderCompletionMessage({
      botName: 'Sniptail',
      text: 'done',
      jobId: 'job-1',
    });

    expect(adapter.capabilities.richTextBlocks).toBe(true);
    expect(rendered.options?.blocks).toBeDefined();
    expect(rendered.options?.components).toBeUndefined();
    const blocks = rendered.options?.blocks as Array<{ type?: string; elements?: unknown[] }>;
    const actionsBlock = blocks.find((block) => block.type === 'actions');
    const hasExplore = (actionsBlock?.elements ?? []).some((element) =>
      String((element as { action_id?: string }).action_id).includes('explore-from-job'),
    );
    expect(hasExplore).toBe(true);
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
    const rows = rendered.options?.components as Array<{ components?: unknown[] }>;
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => (row.components?.length ?? 0) <= 5)).toBe(true);
    const hasExplore = rows
      .flatMap((row) => row.components ?? [])
      .some((component) =>
        String((component as { custom_id?: string }).custom_id).includes(':explore:'),
      );
    expect(hasExplore).toBe(true);
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
