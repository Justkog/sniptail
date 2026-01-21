import type { ThreadEvent } from '@openai/codex-sdk';

export function formatCodexEvent(event: ThreadEvent): string {
  return `[codex] ${new Date().toISOString()} ${JSON.stringify(event)}\n`;
}

export function summarizeCodexEvent(event: ThreadEvent): { text: string; isError: boolean } | null {
  if (event.type === 'item.completed') {
    if (event.item.type === 'command_execution') {
      return {
        text: `Codex ran: ${event.item.command} (${event.item.status})`,
        isError: event.item.status === 'failed',
      };
    }
    if (event.item.type === 'file_change') {
      return {
        text: `Codex file change ${event.item.status}: ${event.item.changes.length} file(s)`,
        isError: event.item.status === 'failed',
      };
    }
    if (event.item.type === 'error') {
      return { text: `Codex error: ${event.item.message}`, isError: true };
    }
  }
  if (event.type === 'turn.failed') {
    return { text: `Codex failed: ${event.error.message}`, isError: true };
  }
  if (event.type === 'error') {
    return { text: `Codex stream error: ${event.message}`, isError: true };
  }
  if (event.type === 'turn.completed') {
    return { text: 'Codex turn completed.', isError: false };
  }
  return null;
}
