import { describe, expect, it } from 'vitest';
import {
  buildDiscordAgentFollowUpBusyComponents,
  buildDiscordAgentFollowUpCustomId,
  buildDiscordAgentPermissionComponents,
  buildDiscordAgentPermissionCustomId,
  buildDiscordAgentQuestionActionCustomId,
  buildDiscordAgentQuestionComponents,
  buildDiscordAgentQuestionModalCustomId,
  buildDiscordAgentQuestionSelectCustomId,
  buildDiscordAgentStopComponents,
  buildDiscordAgentStopCustomId,
  buildDiscordCompletionComponents,
  buildDiscordCompletionCustomId,
  parseDiscordAgentFollowUpCustomId,
  parseDiscordAgentPermissionCustomId,
  parseDiscordAgentQuestionActionCustomId,
  parseDiscordAgentQuestionModalCustomId,
  parseDiscordAgentQuestionSelectCustomId,
  parseDiscordAgentStopCustomId,
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

  it('places review and run with take over and clear job data on the second row', () => {
    const rows = buildDiscordCompletionComponents('job-layout', {
      includeReviewFromJob: true,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.components.map((component) => component.label)).toEqual([
      'Ask',
      'Explore',
      'Plan',
      'Implement',
    ]);
    expect(rows[1]?.components.map((component) => component.label)).toEqual([
      'Review',
      'Run',
      'Take over',
      'Clear job data',
    ]);
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

  it('round-trips agent stop custom ids', () => {
    const customId = buildDiscordAgentStopCustomId('session-123');
    expect(parseDiscordAgentStopCustomId(customId)).toEqual({ sessionId: 'session-123' });
  });

  it('builds an agent stop button', () => {
    expect(buildDiscordAgentStopComponents('session-123')).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: 'Stop',
            custom_id: 'sniptail:agent:stop:session-123',
          },
        ],
      },
    ]);
  });

  it('round-trips agent follow-up custom ids', () => {
    const customId = buildDiscordAgentFollowUpCustomId('steer', 'session-123', 'message-456');
    expect(parseDiscordAgentFollowUpCustomId(customId)).toEqual({
      action: 'steer',
      sessionId: 'session-123',
      messageId: 'message-456',
    });
  });

  it('builds agent follow-up busy buttons', () => {
    const rows = buildDiscordAgentFollowUpBusyComponents('session-123', 'message-456');
    expect(rows[0]?.components.map((component) => component.label)).toEqual(['Queue', 'Steer']);
  });

  it('round-trips agent permission custom ids', () => {
    const customId = buildDiscordAgentPermissionCustomId(
      'always',
      'session-123',
      'interaction-456',
    );
    expect(parseDiscordAgentPermissionCustomId(customId)).toEqual({
      decision: 'always',
      sessionId: 'session-123',
      interactionId: 'interaction-456',
    });
  });

  it('builds agent permission buttons with always allow and stop session', () => {
    const rows = buildDiscordAgentPermissionComponents('session-123', 'interaction-456', {
      allowAlways: true,
    });
    expect(rows[0]?.components.map((component) => component.label)).toEqual([
      'Approve once',
      'Always allow',
      'Reject',
      'Stop session',
    ]);
  });

  it('round-trips agent question custom ids', () => {
    expect(
      parseDiscordAgentQuestionSelectCustomId(
        buildDiscordAgentQuestionSelectCustomId(2, 'session-123', 'interaction-456'),
      ),
    ).toEqual({
      questionIndex: 2,
      sessionId: 'session-123',
      interactionId: 'interaction-456',
    });
    expect(
      parseDiscordAgentQuestionActionCustomId(
        buildDiscordAgentQuestionActionCustomId('reject', 'session-123', 'interaction-456'),
      ),
    ).toEqual({
      action: 'reject',
      sessionId: 'session-123',
      interactionId: 'interaction-456',
    });
    expect(
      parseDiscordAgentQuestionModalCustomId(
        buildDiscordAgentQuestionModalCustomId('session-123', 'interaction-456'),
      ),
    ).toEqual({
      sessionId: 'session-123',
      interactionId: 'interaction-456',
    });
  });

  it('builds agent question select menus and controls', () => {
    const rows = buildDiscordAgentQuestionComponents('session-123', 'interaction-456', [
      {
        header: 'Pick target',
        options: [
          { label: 'Worker', description: 'Worker package' },
          { label: 'Bot', description: 'Bot package' },
        ],
        multiple: false,
        custom: true,
      },
      {
        header: 'Pick checks',
        options: [{ label: 'Tests' }, { label: 'Build' }],
        multiple: true,
        custom: false,
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.components[0]).toMatchObject({
      type: 3,
      placeholder: 'Pick target',
      min_values: 1,
      max_values: 1,
    });
    expect(rows[1]?.components[0]).toMatchObject({
      type: 3,
      placeholder: 'Pick checks',
      min_values: 0,
      max_values: 2,
    });
    expect(
      rows[2]?.components.map((component) => ('label' in component ? component.label : '')),
    ).toEqual(['Answer with text', 'Submit answers', 'Reject', 'Stop session']);
  });

  it('falls back to a numbered placeholder when a question header is omitted', () => {
    const rows = buildDiscordAgentQuestionComponents('session-123', 'interaction-456', [
      {
        options: [{ label: 'One' }],
        multiple: false,
        custom: false,
      },
    ]);

    expect(rows[0]?.components[0]).toMatchObject({
      type: 3,
      placeholder: 'Question 1',
    });
  });
});
