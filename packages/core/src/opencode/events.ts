import type { Event as OpenCodeEvent, Part } from '@opencode-ai/sdk/v2';
import type { OpenCodeClient } from './runtime.js';
import { AssistantMessageTextTracker } from './tracker.js';

function unwrapOpenCodeEvent(event: OpenCodeEvent): OpenCodeEvent {
  const payload = (event as { properties?: { payload?: unknown } }).properties?.payload;
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { type?: unknown }).type === 'string'
  ) {
    return payload as OpenCodeEvent;
  }
  return event;
}

function getEventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const typed = event as { properties?: Record<string, unknown> };
  const properties = typed.properties;
  if (!properties) return undefined;
  if (typeof properties.sessionID === 'string') return properties.sessionID;
  const info = properties.info;
  if (
    info &&
    typeof info === 'object' &&
    typeof (info as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (info as { sessionID: string }).sessionID;
  }
  const part = properties.part;
  if (
    part &&
    typeof part === 'object' &&
    typeof (part as { sessionID?: unknown }).sessionID === 'string'
  ) {
    return (part as { sessionID: string }).sessionID;
  }
  return undefined;
}

function getCompletedAssistantMessageInfo(
  event: OpenCodeEvent,
): { sessionID: string; messageID: string } | undefined {
  if (event.type !== 'message.updated') return undefined;
  const info = event.properties?.info;
  if (!info || typeof info !== 'object') return undefined;
  if (info.role !== 'assistant') return undefined;
  if (typeof info.id !== 'string' || typeof info.sessionID !== 'string') return undefined;
  if (typeof info.time?.completed !== 'number') return undefined;
  return { sessionID: info.sessionID, messageID: info.id };
}

function extractText(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((part): part is Part & { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

export async function fetchCompletedAssistantMessageText(
  client: OpenCodeClient,
  event: OpenCodeEvent,
): Promise<string> {
  const completed = getCompletedAssistantMessageInfo(event);
  if (!completed) return '';
  const message = await client.session.message({
    sessionID: completed.sessionID,
    messageID: completed.messageID,
  });
  if (message.error) {
    throw new Error(`OpenCode message failed: ${JSON.stringify(message.error)}`);
  }
  const assistantMessage = message.data;

  return extractText(assistantMessage?.parts);
}

export async function streamEvents(
  client: OpenCodeClient,
  sessionID: string,
  workDir: string,
  signal: AbortSignal,
  onEvent: ((event: OpenCodeEvent) => void | Promise<void>) | undefined,
  onAssistantMessage: ((text: string, event: OpenCodeEvent) => void | Promise<void>) | undefined,
): Promise<void> {
  if (!onEvent && !onAssistantMessage) return;
  const assistantText = new AssistantMessageTextTracker();
  try {
    const subscription = await client.event.subscribe({ directory: workDir }, { signal });
    for await (const rawEvent of subscription.stream as AsyncGenerator<OpenCodeEvent>) {
      if (signal.aborted) return;
      const event = unwrapOpenCodeEvent(rawEvent);
      const eventSessionId = getEventSessionId(event);
      if (eventSessionId && eventSessionId !== sessionID) continue;
      await onEvent?.(event);
      if (onAssistantMessage) {
        const text = assistantText.handleEvent(event);
        if (text) {
          await onAssistantMessage(text, event);
        }
      }
    }
  } catch {
    if (!signal.aborted) {
      // await onEvent?.({
      //   type: 'session.error',
      //   properties: { sessionID, error: String((err as { message?: unknown })?.message ?? err) },
      // });
    }
  } finally {
    assistantText.close();
  }
}
