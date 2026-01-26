import type { SessionEvent } from '@github/copilot-sdk';

type CopilotEvent = SessionEvent & {
  data?: Record<string, unknown>;
};

const toolCallNameMap = new Map<string, string>();

export function formatCopilotEvent(event: SessionEvent): string {
  return `[copilot] ${new Date().toISOString()} ${JSON.stringify(event)}\n`;
}

export function summarizeCopilotEvent(
  event: CopilotEvent,
): { text: string; isError: boolean } | null {
  if (event.type === 'assistant.message') {
    return { text: 'Copilot responded with a message.', isError: false };
  }
  if (event.type === 'assistant.message_delta') {
    return null;
  }
  if (event.type === 'tool.execution_start') {
    const toolName = event.data?.toolName;
    const toolCallId = event.data?.toolCallId;
    if (typeof toolCallId === 'string' && typeof toolName === 'string') {
      toolCallNameMap.set(toolCallId, toolName);
    }
    return {
      text: `Copilot tool start: ${toolName ?? 'unknown tool'}`,
      isError: false,
    };
  }
  if (event.type === 'tool.execution_complete') {
    const toolCallId = event.data?.toolCallId;
    const toolName = toolCallId && toolCallNameMap.get(toolCallId);
    const success = event.data?.success;
    if (typeof toolCallId === 'string') {
      toolCallNameMap.delete(toolCallId);
    }
    return {
      text: `Copilot tool complete: ${toolName ?? 'unknown tool'}${
        typeof success === 'boolean' ? ` (success: ${success})` : ''
      }`,
      isError: false,
    };
  }
  if (event.type === 'session.error') {
    const message = typeof event.data?.message === 'string' ? event.data.message : 'unknown error';
    return { text: `Copilot error: ${message}`, isError: true };
  }
  if (event.type === 'session.idle') {
    return { text: 'Copilot session idle.', isError: false };
  }
  return null;
}
