import { describe, expect, it } from 'vitest';
import {
  buildDiscordCompletionComponents,
  buildDiscordCompletionCustomId,
  parseDiscordCompletionCustomId,
} from './components.js';

describe('discord completion components', () => {
  it('round-trips explore completion custom ids', () => {
    const customId = buildDiscordCompletionCustomId('exploreFromJob', 'job-123');
    expect(parseDiscordCompletionCustomId(customId)).toEqual({
      action: 'exploreFromJob',
      jobId: 'job-123',
    });
  });

  it('chunks completion buttons into rows of at most 5 components', () => {
    const rows = buildDiscordCompletionComponents('job-rows', {
      includeReviewFromJob: true,
    });

    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.components.length <= 5)).toBe(true);
  });

  it('includes explore action in default completion buttons', () => {
    const rows = buildDiscordCompletionComponents('job-default');
    const customIds = rows.flatMap((row) => row.components.map((component) => component.custom_id));
    expect(customIds.some((customId) => customId.includes(':explore:'))).toBe(true);
  });

  it('round-trips run completion custom ids', () => {
    const customId = buildDiscordCompletionCustomId('runFromJob', 'job-run-123');
    expect(parseDiscordCompletionCustomId(customId)).toEqual({
      action: 'runFromJob',
      jobId: 'job-run-123',
    });
  });

  it('includes run action in default completion buttons', () => {
    const rows = buildDiscordCompletionComponents('job-run-default');
    const customIds = rows.flatMap((row) => row.components.map((component) => component.custom_id));
    expect(customIds.some((customId) => customId.includes(':run:'))).toBe(true);
  });
});
