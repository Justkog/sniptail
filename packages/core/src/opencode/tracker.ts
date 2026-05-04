import type {
  Event as OpenCodeEvent,
  EventMessagePartUpdated,
  EventMessageUpdated,
} from '@opencode-ai/sdk/v2';

function isMessageUpdatedEvent(event: OpenCodeEvent): event is EventMessageUpdated {
  return event.type === 'message.updated';
}

function isMessagePartUpdatedEvent(event: OpenCodeEvent): event is EventMessagePartUpdated {
  return event.type === 'message.part.updated';
}

function isMessageComplete(info: EventMessageUpdated['properties']['info']): boolean {
  if (info.role !== 'assistant') return false;
  return info.time?.completed != null;
}

export class AssistantMessageTextTracker {
  private readonly messageRoles = new Map<string, string>();
  private readonly emittedTextLengths = new Map<string, number>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly partMessageIds = new Map<string, string>();

  handleEvent(event: OpenCodeEvent): string | undefined {
    if (isMessageUpdatedEvent(event)) {
      this.trackMessage(event);
      return undefined;
    }
    if (!isMessagePartUpdatedEvent(event)) return undefined;
    return this.extractTextDelta(event);
  }

  close(): void {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.messageRoles.clear();
    this.emittedTextLengths.clear();
    this.partMessageIds.clear();
  }

  private trackMessage(event: EventMessageUpdated): void {
    const { info } = event.properties;
    if (typeof info.id !== 'string' || typeof info.role !== 'string') return;
    this.messageRoles.set(info.id, info.role);
    if (isMessageComplete(info)) {
      this.scheduleCleanup(info.id);
    }
  }

  private extractTextDelta(event: EventMessagePartUpdated): string | undefined {
    const { part } = event.properties;
    if (!part || part.type !== 'text' || typeof part.id !== 'string') return undefined;

    const messageID = this.getPartMessageId(event);
    if (!messageID || this.messageRoles.get(messageID) !== 'assistant') return undefined;

    this.partMessageIds.set(part.id, messageID);
    const previousLength = this.emittedTextLengths.get(part.id) ?? 0;
    const text = typeof part.text === 'string' ? part.text : undefined;

    if (!text || text.length <= previousLength) return undefined;

    const nextDelta = text.slice(previousLength);
    this.emittedTextLengths.set(part.id, text.length);
    return nextDelta;
  }

  private getPartMessageId(event: EventMessagePartUpdated): string | undefined {
    const { part } = event.properties;
    const messageID = part?.messageID;
    return typeof messageID === 'string' ? messageID : undefined;
  }

  private scheduleCleanup(messageID: string): void {
    if (this.cleanupTimers.has(messageID)) return;
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(messageID);
      this.messageRoles.delete(messageID);
      for (const [partID, partMessageID] of this.partMessageIds) {
        if (partMessageID !== messageID) continue;
        this.partMessageIds.delete(partID);
        this.emittedTextLengths.delete(partID);
      }
    }, 30_000);
    this.cleanupTimers.set(messageID, timer);
  }
}
