import { describe, expect, it } from 'vitest';
import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2';
import { formatOpenCodeEvent, summarizeOpenCodeEvent } from './logging.js';

function buildAssistantMessage() {
  return {
    id: 'msg-1',
    sessionID: 'session-1',
    role: 'assistant' as const,
    time: { created: 1, completed: 2 },
    parentID: 'parent-1',
    modelID: 'claude-sonnet',
    providerID: 'anthropic',
    mode: 'build',
    agent: 'build',
    path: { cwd: '/tmp/work', root: '/tmp/work' },
    cost: 0,
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

describe('OpenCode logging', () => {
  it('formats events with opencode prefix', () => {
    const event = {
      type: 'file.edited',
      properties: { file: 'src/index.ts' },
    } satisfies OpenCodeEvent;

    expect(formatOpenCodeEvent(event)).toContain('[opencode]');
    expect(formatOpenCodeEvent(event)).toContain('"file.edited"');
  });

  it('summarizes important events', () => {
    expect(
      summarizeOpenCodeEvent({
        type: 'file.edited',
        properties: { file: 'src/index.ts' },
      }),
    ).toEqual({ text: 'OpenCode edited file: src/index.ts', isError: false });

    expect(
      summarizeOpenCodeEvent({
        type: 'command.executed',
        properties: {
          name: 'git',
          arguments: 'status',
          sessionID: 'session-1',
          messageID: 'message-1',
        },
      }),
    ).toEqual({ text: 'OpenCode executed command: git status', isError: false });

    expect(
      summarizeOpenCodeEvent({
        type: 'session.error',
        properties: { error: { message: 'failed' } },
      }),
    ).toEqual({
      text: 'OpenCode session error: {"message":"failed"}',
      isError: true,
    });

    expect(
      summarizeOpenCodeEvent({
        type: 'message.updated',
        properties: { sessionID: 'session-1', info: buildAssistantMessage() },
      }),
    ).toEqual({ text: 'OpenCode assistant message completed', isError: false });
  });
});
