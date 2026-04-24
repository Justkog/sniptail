import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2';

export function formatOpenCodeEvent(event: OpenCodeEvent): string {
  return `[opencode] ${new Date().toISOString()} ${JSON.stringify(event)}\n`;
}

export function summarizeOpenCodeEvent(
  event: OpenCodeEvent,
): { text: string; isError: boolean } | null {
  switch (event.type) {
    case 'command.executed': {
      const { name, arguments: args } = event.properties;
      return {
        text: `OpenCode executed command: ${args ? `${name} ${args}` : name}`,
        isError: false,
      };
    }
    case 'file.edited': {
      return { text: `OpenCode edited file: ${event.properties.file}`, isError: false };
    }
    case 'session.error': {
      return {
        text: `OpenCode session error: ${JSON.stringify(event.properties.error ?? event.properties)}`,
        isError: true,
      };
    }
    case 'message.updated': {
      if (event.properties.info.role === 'assistant' && event.properties.info.time.completed) {
        return { text: 'OpenCode assistant message completed', isError: false };
      }
      return null;
    }
    default:
      return null;
  }
}
