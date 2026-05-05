import { randomUUID } from 'node:crypto';
import type {
  CopilotPermissionDecision,
  CopilotPermissionHandler,
  CopilotPermissionRequest,
  CopilotUserInputHandler,
  CopilotUserInputRequest,
  CopilotUserInputResponse,
} from '@sniptail/core/agents/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import {
  buildPermissionRequestEvent,
  buildQuestionRequestEvent,
  publishPermissionUpdated,
  publishQuestionUpdated,
} from './interactiveAgentEvents.js';

type AgentResponse = CoreWorkerEvent<'agent.session.start'>['payload']['response'];

type PermissionDisplayState = 'queued' | 'visible' | 'reply_sent';

type PendingInteractionBase = {
  sessionId: string;
  interactionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  expiresAt: string;
  timeout: NodeJS.Timeout;
};

type PendingPermissionInteraction = PendingInteractionBase & {
  kind: 'permission';
  displayState: PermissionDisplayState;
  allowAlways: boolean;
  request: CopilotPermissionRequest;
  requestEvent: ReturnType<typeof buildPermissionRequestEvent>;
  resolveResult: (result: CopilotPermissionDecision) => void;
};

type PendingQuestionInteraction = PendingInteractionBase & {
  kind: 'question';
  request: CopilotUserInputRequest;
  resolveResult: (result: CopilotUserInputResponse) => void;
  rejectResult: (error: Error) => void;
};

type PendingInteraction = PendingPermissionInteraction | PendingQuestionInteraction;

type CopilotPermissionRequestInput = {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
  request: CopilotPermissionRequest;
};

type CopilotQuestionRequestInput = {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
  request: CopilotUserInputRequest;
};

type ResolveInput = {
  event: CoreWorkerEvent<'agent.interaction.resolve'>;
  notifier: Notifier;
  botEvents: BotEventSink;
};

type ClearInput = {
  sessionId: string;
  botEvents?: BotEventSink;
  message?: string;
};

const pendingInteractions = new Map<string, PendingInteraction>();
const pendingPermissionOrder = new Map<string, string[]>();

function pendingInteractionKey(sessionId: string, interactionId: string): string {
  return `${sessionId}:${interactionId}`;
}

function buildRef(response: AgentResponse) {
  return {
    provider: response.provider,
    channelId: response.channelId,
    ...(response.threadId ? { threadId: response.threadId } : {}),
  };
}

function getPendingInteraction(
  sessionId: string,
  interactionId: string,
): PendingInteraction | undefined {
  return pendingInteractions.get(pendingInteractionKey(sessionId, interactionId));
}

function getPendingPermission(
  sessionId: string,
  interactionId: string,
): PendingPermissionInteraction | undefined {
  const pending = getPendingInteraction(sessionId, interactionId);
  return pending?.kind === 'permission' ? pending : undefined;
}

function deletePendingInteraction(interaction: PendingInteraction): void {
  pendingInteractions.delete(pendingInteractionKey(interaction.sessionId, interaction.interactionId));
  clearTimeout(interaction.timeout);

  if (interaction.kind !== 'permission') {
    return;
  }

  const order = pendingPermissionOrder.get(interaction.sessionId) ?? [];
  const nextOrder = order.filter((id) => id !== interaction.interactionId);
  if (nextOrder.length > 0) {
    pendingPermissionOrder.set(interaction.sessionId, nextOrder);
  } else {
    pendingPermissionOrder.delete(interaction.sessionId);
  }
}

function hasVisiblePermission(sessionId: string): boolean {
  const order = pendingPermissionOrder.get(sessionId) ?? [];
  return order.some((interactionId) => {
    const pending = getPendingPermission(sessionId, interactionId);
    return pending?.displayState === 'visible' || pending?.displayState === 'reply_sent';
  });
}

async function publishPromotedPermission(input: {
  sessionId: string;
  botEvents: BotEventSink;
}): Promise<void> {
  if (hasVisiblePermission(input.sessionId)) {
    return;
  }

  const order = pendingPermissionOrder.get(input.sessionId) ?? [];
  for (const interactionId of order) {
    const pending = getPendingPermission(input.sessionId, interactionId);
    if (!pending || pending.displayState !== 'queued') {
      continue;
    }
    pending.displayState = 'visible';
    await input.botEvents.publish(pending.requestEvent);
    return;
  }
}

function rememberPermissionOrder(sessionId: string, interactionId: string): void {
  const order = pendingPermissionOrder.get(sessionId) ?? [];
  if (!order.includes(interactionId)) {
    order.push(interactionId);
    pendingPermissionOrder.set(sessionId, order);
  }
}

function buildPersistentPermissionDecision(
  request: CopilotPermissionRequest,
): CopilotPermissionDecision | undefined {
  switch (request.kind) {
    case 'read':
      return {
        kind: 'approve-for-session',
        approval: { kind: 'read' },
      };
    case 'write':
      return {
        kind: 'approve-for-session',
        approval: { kind: 'write' },
      };
    case 'memory':
      return {
        kind: 'approve-for-session',
        approval: { kind: 'memory' },
      };
    default:
      return undefined;
  }
}

function permissionDecisionCoversRequest(
  decision: CopilotPermissionDecision,
  request: CopilotPermissionRequest,
): boolean {
  if (decision.kind !== 'approve-for-session' && decision.kind !== 'approve-for-location') {
    return false;
  }

  switch (decision.approval.kind) {
    case 'read':
    case 'write':
    case 'memory':
      return request.kind === decision.approval.kind;
    default:
      return false;
  }
}

function permissionDecisionStatus(
  decision: CopilotPermissionDecision,
): 'approved_once' | 'approved_always' | 'rejected' {
  if (decision.kind === 'approve-for-session' || decision.kind === 'approve-for-location') {
    return 'approved_always';
  }
  if (decision.kind === 'reject') {
    return 'rejected';
  }
  return 'approved_once';
}

function buildPermissionDecision(
  request: CopilotPermissionRequest,
  resolution: Extract<
    CoreWorkerEvent<'agent.interaction.resolve'>['payload']['resolution'],
    { kind: 'permission' }
  >,
): CopilotPermissionDecision {
  switch (resolution.decision) {
    case 'once':
      return { kind: 'approve-once' };
    case 'always':
      return (
        buildPersistentPermissionDecision(request) ?? {
          kind: 'approve-once',
        }
      );
    case 'reject':
      return {
        kind: 'reject',
        ...(resolution.message ? { feedback: resolution.message } : {}),
      };
  }
}

function resolveQueuedCoveredPermissions(
  sessionId: string,
  decision: CopilotPermissionDecision,
): void {
  const order = pendingPermissionOrder.get(sessionId) ?? [];
  for (const interactionId of order) {
    const pending = getPendingPermission(sessionId, interactionId);
    if (!pending || pending.displayState !== 'queued') {
      continue;
    }
    if (!permissionDecisionCoversRequest(decision, pending.request)) {
      continue;
    }

    deletePendingInteraction(pending);
    pending.resolveResult(decision);
  }
}

function validateCopilotUserInputResolution(
  resolution: Extract<
    CoreWorkerEvent<'agent.interaction.resolve'>['payload']['resolution'],
    { kind: 'question' }
  >,
): string | 'invalid-shape' | undefined {
  const answerGroups = resolution.answers?.filter((group) =>
    group.some((value) => value.trim().length > 0),
  );

  if (!answerGroups || answerGroups.length === 0) {
    return undefined;
  }
  if (answerGroups.length > 1) {
    return 'invalid-shape';
  }

  const answers = answerGroups[0]
    ?.map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (!answers || answers.length === 0) {
    return undefined;
  }
  if (answers.length > 1) {
    return 'invalid-shape';
  }

  return answers[0];
}

async function timeoutPermission(input: {
  sessionId: string;
  interactionId: string;
  botEvents: BotEventSink;
}) {
  const pending = getPendingPermission(input.sessionId, input.interactionId);
  if (!pending) {
    return;
  }

  const wasVisible = pending.displayState === 'visible' || pending.displayState === 'reply_sent';
  deletePendingInteraction(pending);
  pending.resolveResult({ kind: 'user-not-available' });

  if (wasVisible) {
    await publishPermissionUpdated({
      botEvents: input.botEvents,
      response: pending.response,
      sessionId: pending.sessionId,
      interactionId: pending.interactionId,
      status: 'expired',
      message: 'Permission request expired.',
    });
  }

  await publishPromotedPermission({
    sessionId: input.sessionId,
    botEvents: input.botEvents,
  });
}

async function timeoutQuestion(input: {
  sessionId: string;
  interactionId: string;
  botEvents: BotEventSink;
}) {
  const pending = getPendingInteraction(input.sessionId, input.interactionId);
  if (!pending || pending.kind !== 'question') {
    return;
  }

  deletePendingInteraction(pending);
  pending.rejectResult(new Error('User input request expired.'));
  await publishQuestionUpdated({
    botEvents: input.botEvents,
    response: pending.response,
    sessionId: pending.sessionId,
    interactionId: pending.interactionId,
    status: 'expired',
    message: 'Question request expired.',
  });
}

export async function requestCopilotPermission(
  input: CopilotPermissionRequestInput,
): Promise<CopilotPermissionDecision> {
  return await new Promise<CopilotPermissionDecision>((resolveResult) => {
    const interactionId = randomUUID();
    const expiresAt = new Date(Date.now() + input.timeoutMs).toISOString();
    const allowAlways = buildPersistentPermissionDecision(input.request) !== undefined;
    const requestEvent = buildPermissionRequestEvent({
      response: input.response,
      sessionId: input.sessionId,
      interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      toolName: input.request.kind,
      ...(input.request.toolCallId
        ? { details: [`Tool call: ${input.request.toolCallId}`] }
        : {}),
      expiresAt,
      allowAlways,
    });
    const pending: PendingPermissionInteraction = {
      sessionId: input.sessionId,
      interactionId,
      response: input.response,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      kind: 'permission',
      displayState: 'queued',
      allowAlways,
      request: input.request,
      expiresAt,
      requestEvent,
      timeout: setTimeout(() => {
        void timeoutPermission({
          sessionId: input.sessionId,
          interactionId,
          botEvents: input.botEvents,
        });
      }, input.timeoutMs),
      resolveResult,
    };

    pendingInteractions.set(pendingInteractionKey(input.sessionId, interactionId), pending);
    rememberPermissionOrder(input.sessionId, interactionId);

    void (async () => {
      if (!hasVisiblePermission(input.sessionId)) {
        await publishPromotedPermission({
          sessionId: input.sessionId,
          botEvents: input.botEvents,
        });
      }
    })().catch((err) => {
      logger.error(
        { err, sessionId: input.sessionId, interactionId },
        'Failed to publish Copilot permission request',
      );
      const current = getPendingPermission(input.sessionId, interactionId);
      if (!current) {
        return;
      }
      deletePendingInteraction(current);
      current.resolveResult({ kind: 'user-not-available' });
    });
  });
}

export async function requestCopilotUserInput(
  input: CopilotQuestionRequestInput,
): Promise<CopilotUserInputResponse> {
  return await new Promise<CopilotUserInputResponse>((resolveResult, rejectResult) => {
    const interactionId = randomUUID();
    const expiresAt = new Date(Date.now() + input.timeoutMs).toISOString();
    const pending: PendingQuestionInteraction = {
      sessionId: input.sessionId,
      interactionId,
      response: input.response,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      kind: 'question',
      request: input.request,
      expiresAt,
      timeout: setTimeout(() => {
        void timeoutQuestion({
          sessionId: input.sessionId,
          interactionId,
          botEvents: input.botEvents,
        });
      }, input.timeoutMs),
      resolveResult,
      rejectResult,
    };

    pendingInteractions.set(pendingInteractionKey(input.sessionId, interactionId), pending);

    void input.botEvents
      .publish(
        buildQuestionRequestEvent({
          response: input.response,
          sessionId: input.sessionId,
          interactionId,
          workspaceKey: input.workspaceKey,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          questions: [
            {
              question: input.request.question,
              options: (input.request.choices ?? []).map((choice: string) => ({ label: choice })),
              multiple: false,
              custom: input.request.allowFreeform ?? true,
            },
          ],
          expiresAt,
        }),
      )
      .catch((err) => {
        logger.error(
          { err, sessionId: input.sessionId, interactionId },
          'Failed to publish Copilot user input request',
        );
        const current = getPendingInteraction(input.sessionId, interactionId);
        if (!current || current.kind !== 'question') {
          return;
        }
        deletePendingInteraction(current);
        current.rejectResult(new Error('Failed to publish user input request.'));
      });
  });
}

export async function resolveBrokeredCopilotInteraction({
  event,
  notifier,
  botEvents,
}: ResolveInput): Promise<void> {
  const { sessionId, interactionId, resolution, response } = event.payload;
  const ref = buildRef(response);
  const pending = getPendingInteraction(sessionId, interactionId);

  if (!pending) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }

  if (pending.kind !== resolution.kind) {
    await notifier.postMessage(ref, 'This agent interaction no longer matches the selected control.');
    return;
  }

  if (pending.kind === 'permission' && resolution.kind === 'permission') {
    if (pending.displayState === 'reply_sent') {
      await notifier.postMessage(ref, 'This agent permission is already being resolved.');
      return;
    }
    if (pending.displayState !== 'visible') {
      await notifier.postMessage(ref, 'This agent permission is not currently displayed.');
      return;
    }
    if (resolution.decision === 'always' && !pending.allowAlways) {
      await notifier.postMessage(ref, 'This agent interaction no longer matches the selected control.');
      return;
    }

    pending.displayState = 'reply_sent';
    deletePendingInteraction(pending);
    const decision = buildPermissionDecision(pending.request, resolution);
    pending.resolveResult(decision);
    resolveQueuedCoveredPermissions(sessionId, decision);
    await publishPermissionUpdated({
      botEvents,
      response: pending.response,
      sessionId,
      interactionId,
      status: permissionDecisionStatus(decision),
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(resolution.message ? { message: resolution.message } : {}),
    });
    await publishPromotedPermission({ sessionId, botEvents });
    return;
  }

  if (pending.kind === 'question' && resolution.kind === 'question' && resolution.reject) {
    deletePendingInteraction(pending);
    pending.rejectResult(new Error(resolution.message || 'User rejected input request.'));
    await publishQuestionUpdated({
      botEvents,
      response: pending.response,
      sessionId,
      interactionId,
      status: 'rejected',
      ...(response.userId ? { actorUserId: response.userId } : {}),
      ...(resolution.message ? { message: resolution.message } : {}),
    });
    return;
  }

  if (pending.kind !== 'question' || resolution.kind !== 'question') {
    await notifier.postMessage(ref, 'This agent interaction no longer matches the selected control.');
    return;
  }

  const answer = validateCopilotUserInputResolution(resolution);
  if (answer === 'invalid-shape') {
    await notifier.postMessage(ref, 'Copilot user input expects a single answer.');
    return;
  }
  if (!answer) {
    await notifier.postMessage(ref, 'This agent question requires an answer.');
    return;
  }

  deletePendingInteraction(pending);
  const answerFromChoice = pending.request.choices?.includes(answer) ?? false;
  pending.resolveResult({
    answer,
    wasFreeform: !answerFromChoice,
  });
  await publishQuestionUpdated({
    botEvents,
    response: pending.response,
    sessionId,
    interactionId,
    status: 'answered',
    ...(response.userId ? { actorUserId: response.userId } : {}),
    ...(resolution.message ? { message: resolution.message } : {}),
  });
}

export async function clearBrokeredCopilotInteractions({
  sessionId,
  botEvents,
  message = 'Agent session ended before this interaction was resolved.',
}: ClearInput): Promise<void> {
  const stale: PendingInteraction[] = [];

  for (const pending of pendingInteractions.values()) {
    if (pending.sessionId === sessionId) {
      stale.push(pending);
    }
  }

  for (const pending of stale) {
    deletePendingInteraction(pending);
    if (pending.kind === 'permission') {
      pending.resolveResult({ kind: 'user-not-available' });
      if (
        botEvents &&
        (pending.displayState === 'visible' || pending.displayState === 'reply_sent')
      ) {
        await publishPermissionUpdated({
          botEvents,
          response: pending.response,
          sessionId: pending.sessionId,
          interactionId: pending.interactionId,
          status: 'failed',
          message,
        });
      }
      continue;
    }

    pending.rejectResult(new Error(message));
    if (botEvents) {
      await publishQuestionUpdated({
        botEvents,
        response: pending.response,
        sessionId: pending.sessionId,
        interactionId: pending.interactionId,
        status: 'failed',
        message,
      });
    }
  }
}

export function buildCopilotPermissionHandler(input: {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
}): CopilotPermissionHandler {
  return async (request: CopilotPermissionRequest) =>
    await requestCopilotPermission({
      ...input,
      request,
    });
}

export function buildCopilotUserInputHandler(input: {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
}): CopilotUserInputHandler {
  return async (request: CopilotUserInputRequest) =>
    await requestCopilotUserInput({
      ...input,
      request,
    });
}
