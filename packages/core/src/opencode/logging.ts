import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2';

function summarizeToolInput(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  if (!serialized || serialized === '{}') return '';
  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
}

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
    case 'message.part.updated': {
      const { part } = event.properties;
      if (part.type !== 'tool') return null;

      const input = summarizeToolInput(part.state.input);
      const suffix = input ? ` ${input}` : '';

      switch (part.state.status) {
        case 'running':
          return {
            text: `OpenCode tool running: ${part.tool}${suffix}`,
            isError: false,
          };
        case 'completed':
          return {
            text: `OpenCode tool complete: ${part.tool}${suffix}`,
            isError: false,
          };
        case 'error':
          return {
            text: `OpenCode tool error: ${part.tool}${suffix}: ${part.state.error}`,
            isError: true,
          };
        case 'pending':
          return null;
      }
      return null;
    }
    default:
      return null;
  }
}
