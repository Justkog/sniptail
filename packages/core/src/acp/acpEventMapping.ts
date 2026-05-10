import type {
  Plan,
  SessionNotification,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  UsageUpdate,
} from '@agentclientprotocol/sdk';

type EventSummary = {
  text: string;
  isError: boolean;
};

function summarizeRawPayload(payload: unknown): string {
  if (payload === undefined) return '';
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized === '{}' || serialized === '[]') return '';
  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
}

function summarizeToolLocations(update: ToolCall | ToolCallUpdate): string {
  const firstLocation = update.locations?.[0]?.path;
  const count = update.locations?.length ?? 0;
  if (!firstLocation) return '';
  return count > 1 ? ` (${firstLocation} +${count - 1} more)` : ` (${firstLocation})`;
}

function summarizeToolDetails(update: ToolCall | ToolCallUpdate): string {
  const payload = summarizeRawPayload(update.rawInput);
  return payload ? ` ${payload}` : '';
}

function summarizeToolUpdate(update: ToolCall | ToolCallUpdate): EventSummary {
  const title = update.title?.trim() || `tool ${update.toolCallId}`;
  const status = update.status ?? 'updated';
  const location = summarizeToolLocations(update);
  const details = summarizeToolDetails(update);
  return {
    text: `ACP tool ${status}: ${title}${location}${details}`,
    isError: status === 'failed',
  };
}

function summarizePlan(update: Plan): EventSummary {
  const pending = update.entries.filter((entry) => entry.status === 'pending').length;
  const inProgress = update.entries.filter((entry) => entry.status === 'in_progress');
  const completed = update.entries.filter((entry) => entry.status === 'completed').length;
  const focus = inProgress[0]?.content?.trim();
  return {
    text: focus
      ? `ACP plan: ${pending} pending, ${inProgress.length} in progress, ${completed} completed. Active: ${focus}`
      : `ACP plan: ${pending} pending, ${inProgress.length} in progress, ${completed} completed.`,
    isError: false,
  };
}

function summarizeUsage(update: UsageUpdate): EventSummary {
  const cost =
    update.cost && Number.isFinite(update.cost.amount)
      ? `, cost ${update.cost.amount} ${update.cost.currency}`
      : '';
  return {
    text: `ACP usage: ${update.used}/${update.size} tokens${cost}`,
    isError: false,
  };
}

export function formatAcpEvent(notification: SessionNotification): string {
  return `[acp] ${new Date().toISOString()} ${JSON.stringify(notification)}\n`;
}

export function extractAcpAssistantText(notification: SessionNotification): string | undefined {
  const update = notification.update;
  if (update.sessionUpdate !== 'agent_message_chunk') return undefined;
  return update.content.type === 'text' ? update.content.text : undefined;
}

export function summarizeAcpEvent(notification: SessionNotification): EventSummary | null {
  const update: SessionUpdate = notification.update;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk':
      return null;
    case 'tool_call':
    case 'tool_call_update':
      return summarizeToolUpdate(update);
    case 'plan':
      return summarizePlan(update);
    case 'usage_update':
      return summarizeUsage(update);
    case 'current_mode_update':
      return { text: `ACP mode changed: ${update.currentModeId}`, isError: false };
    case 'config_option_update':
      return {
        text: `ACP config options updated: ${update.configOptions.length} option(s)`,
        isError: false,
      };
    case 'available_commands_update':
      return {
        text: `ACP available commands updated: ${update.availableCommands.length} command(s)`,
        isError: false,
      };
    case 'session_info_update':
      if (update.title?.trim()) {
        return { text: `ACP session title updated: ${update.title}`, isError: false };
      }
      return null;
    default:
      return null;
  }
}
