import type { WorkerReplyTarget } from '@sniptail/core/types/worker-event.js';

export type QueuedOpenCodeFollowUp = {
  sessionId: string;
  response: WorkerReplyTarget;
  message: string;
  messageId?: string;
};

type ActiveOpenCodePromptTurn = {
  queue: QueuedOpenCodeFollowUp[];
  steerNext?: QueuedOpenCodeFollowUp;
  abortingForSteer: boolean;
};

const activeOpenCodePromptTurns = new Map<string, ActiveOpenCodePromptTurn>();

export function beginOpenCodePromptTurn(sessionId: string): boolean {
  if (activeOpenCodePromptTurns.has(sessionId)) return false;
  activeOpenCodePromptTurns.set(sessionId, {
    queue: [],
    abortingForSteer: false,
  });
  return true;
}

export function isOpenCodePromptTurnActive(sessionId: string): boolean {
  return activeOpenCodePromptTurns.has(sessionId);
}

export function enqueueOpenCodeFollowUp(followUp: QueuedOpenCodeFollowUp): void {
  const active = activeOpenCodePromptTurns.get(followUp.sessionId);
  if (!active) return;
  active.queue.push(followUp);
}

export function steerOpenCodeFollowUp(followUp: QueuedOpenCodeFollowUp): void {
  const active = activeOpenCodePromptTurns.get(followUp.sessionId);
  if (!active) return;
  active.steerNext = followUp;
  active.abortingForSteer = true;
}

export function isAbortingOpenCodePromptForSteer(sessionId: string): boolean {
  return activeOpenCodePromptTurns.get(sessionId)?.abortingForSteer ?? false;
}

export function cancelOpenCodeFollowUpSteer(sessionId: string): void {
  const active = activeOpenCodePromptTurns.get(sessionId);
  if (!active) return;
  delete active.steerNext;
  active.abortingForSteer = false;
}

export function finishOpenCodePromptTurn(sessionId: string): QueuedOpenCodeFollowUp | undefined {
  const active = activeOpenCodePromptTurns.get(sessionId);
  if (!active) return undefined;
  const next = active.steerNext ?? active.queue.shift();
  if (next) {
    delete active.steerNext;
    active.abortingForSteer = false;
    return next;
  }
  activeOpenCodePromptTurns.delete(sessionId);
  return undefined;
}

export function clearOpenCodePromptTurn(sessionId: string): void {
  activeOpenCodePromptTurns.delete(sessionId);
}

export function clearOpenCodePromptTurns(): void {
  activeOpenCodePromptTurns.clear();
}
