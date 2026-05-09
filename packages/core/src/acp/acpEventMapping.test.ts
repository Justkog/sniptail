import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { extractAcpAssistantText, formatAcpEvent, summarizeAcpEvent } from './acpEventMapping.js';

function buildNotification(update: SessionNotification['update']): SessionNotification {
  return {
    sessionId: 'session-1',
    update,
  };
}

describe('ACP event mapping', () => {
  it('extracts assistant text from agent message chunks', () => {
    const notification = buildNotification({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello world' },
    });

    expect(extractAcpAssistantText(notification)).toBe('hello world');
  });

  it('ignores non-text agent message chunks for assistant output', () => {
    const notification = buildNotification({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'resource_link', uri: 'file:///tmp/report.md', name: 'report' },
    });

    expect(extractAcpAssistantText(notification)).toBeUndefined();
  });

  it('does not expose thought chunks as assistant output', () => {
    const notification = buildNotification({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking...' },
    });

    expect(extractAcpAssistantText(notification)).toBeUndefined();
  });

  it('summarizes thought chunks for logs only', () => {
    const notification = buildNotification({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Inspecting config' },
    });

    expect(summarizeAcpEvent(notification)).toEqual({
      text: 'ACP thought: Inspecting config',
      isError: false,
    });
  });

  it('summarizes tool start events with path and raw input', () => {
    const notification = buildNotification({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Read settings',
      status: 'in_progress',
      locations: [{ path: 'packages/core/src/config/env.ts' }],
      rawInput: { path: 'packages/core/src/config/env.ts' },
    });

    expect(summarizeAcpEvent(notification)).toEqual({
      text: 'ACP tool in_progress: Read settings (packages/core/src/config/env.ts) {"path":"packages/core/src/config/env.ts"}',
      isError: false,
    });
  });

  it('summarizes failed tool updates as errors', () => {
    const notification = buildNotification({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      title: 'Edit config',
      status: 'failed',
      rawInput: { path: 'sniptail.worker.toml' },
    });

    expect(summarizeAcpEvent(notification)).toEqual({
      text: 'ACP tool failed: Edit config {"path":"sniptail.worker.toml"}',
      isError: true,
    });
  });

  it('summarizes plans with counts and active entry', () => {
    const notification = buildNotification({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect runtime', priority: 'high', status: 'completed' },
        { content: 'Map events', priority: 'high', status: 'in_progress' },
        { content: 'Write tests', priority: 'medium', status: 'pending' },
      ],
    });

    expect(summarizeAcpEvent(notification)).toEqual({
      text: 'ACP plan: 1 pending, 1 in progress, 1 completed. Active: Map events',
      isError: false,
    });
  });

  it('summarizes usage updates including cost when present', () => {
    const notification = buildNotification({
      sessionUpdate: 'usage_update',
      used: 1200,
      size: 8000,
      cost: { amount: 0.42, currency: 'USD' },
    });

    expect(summarizeAcpEvent(notification)).toEqual({
      text: 'ACP usage: 1200/8000 tokens, cost 0.42 USD',
      isError: false,
    });
  });

  it('keeps message chunks out of summary logs', () => {
    const notification = buildNotification({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'visible to user' },
    });

    expect(summarizeAcpEvent(notification)).toBeNull();
  });

  it('formats ACP notifications with prefix and trailing newline', () => {
    const notification = buildNotification({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'build',
    });
    const formatted = formatAcpEvent(notification);

    expect(formatted.startsWith('[acp] ')).toBe(true);
    expect(formatted.endsWith('\n')).toBe(true);
    expect(formatted).toContain('"sessionUpdate":"current_mode_update"');
    expect(formatted).toContain('"currentModeId":"build"');
  });
});
