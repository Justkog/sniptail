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

  it('builds Slack reaction events with message ids', () => {
    const adapter = resolveWorkerChannelAdapter('slack');
    const event = adapter.buildAddReactionEvent(
      { provider: 'slack', channelId: 'C1', threadId: 'thread-1' },
      'eyes',
      { messageId: '1712345678.000100' },
      'job-4',
    );

    expect(adapter.capabilities.reactions).toBe(true);
    expect(event).toEqual({
      schemaVersion: 1,
      provider: 'slack',
      type: 'reaction.add',
      jobId: 'job-4',
      payload: {
        channelId: 'C1',
        threadId: 'thread-1',
        messageId: '1712345678.000100',
        name: 'eyes',
      },
    });
  });

  it('builds Discord reaction events with message ids', () => {
    const adapter = resolveWorkerChannelAdapter('discord');
    const event = adapter.buildAddReactionEvent(
      { provider: 'discord', channelId: 'D1', threadId: 'thread-9' },
      'eyes',
      { messageId: 'M1' },
      'job-5',
    );

    expect(adapter.capabilities.reactions).toBe(true);
    expect(event).toEqual({
      schemaVersion: 1,
      provider: 'discord',
      type: 'reaction.add',
      jobId: 'job-5',
      payload: {
        channelId: 'D1',
        threadId: 'thread-9',
        messageId: 'M1',
        name: 'eyes',
      },
    });
  });

  it('returns no reaction event for unsupported providers', () => {
    const telegramAdapter = resolveWorkerChannelAdapter('telegram');
    const genericAdapter = resolveWorkerChannelAdapter('http');

    expect(
      telegramAdapter.buildAddReactionEvent({ provider: 'telegram', channelId: 'T1' }, 'eyes', {
        messageId: '10',
      }),
    ).toBeUndefined();
    expect(
      genericAdapter.buildAddReactionEvent({ provider: 'http', channelId: 'H1' }, 'eyes', {
        messageId: '10',
      }),
    ).toBeUndefined();
  });
});
