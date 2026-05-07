import type { WorkerReplyTarget } from '@sniptail/core/types/worker-event.js';

export type QueuedAgentFollowUp = {
  sessionId: string;
  response: WorkerReplyTarget;
  message: string;
  messageId?: string;
};

type ActiveAgentPromptTurn = {
  queue: QueuedAgentFollowUp[];
  steerNext?: QueuedAgentFollowUp;
  abortingForSteer: boolean;
};

const activeAgentPromptTurns = new Map<string, ActiveAgentPromptTurn>();

export function beginAgentPromptTurn(sessionId: string): boolean {
  if (activeAgentPromptTurns.has(sessionId)) return false;
  activeAgentPromptTurns.set(sessionId, {
    queue: [],
    abortingForSteer: false,
  });
  return true;
}

export function isAgentPromptTurnActive(sessionId: string): boolean {
  return activeAgentPromptTurns.has(sessionId);
}

export function enqueueAgentFollowUp(followUp: QueuedAgentFollowUp): void {
  const active = activeAgentPromptTurns.get(followUp.sessionId);
  if (!active) return;
  active.queue.push(followUp);
}

export function steerAgentFollowUp(followUp: QueuedAgentFollowUp): void {
  const active = activeAgentPromptTurns.get(followUp.sessionId);
  if (!active) return;
  active.steerNext = followUp;
  active.abortingForSteer = true;
}

export function isAbortingAgentPromptForSteer(sessionId: string): boolean {
  return activeAgentPromptTurns.get(sessionId)?.abortingForSteer ?? false;
}

export function cancelAgentFollowUpSteer(sessionId: string): void {
  const active = activeAgentPromptTurns.get(sessionId);
  if (!active) return;
  delete active.steerNext;
  active.abortingForSteer = false;
}

export function finishAgentPromptTurn(sessionId: string): QueuedAgentFollowUp | undefined {
  const active = activeAgentPromptTurns.get(sessionId);
  if (!active) return undefined;
  const next = active.steerNext ?? active.queue.shift();
  if (next) {
    delete active.steerNext;
    active.abortingForSteer = false;
    return next;
  }
  activeAgentPromptTurns.delete(sessionId);
  return undefined;
}

export function clearAgentPromptTurn(sessionId: string): void {
  activeAgentPromptTurns.delete(sessionId);
}

export function clearAgentPromptTurns(): void {
  activeAgentPromptTurns.clear();
}
