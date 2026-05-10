import { randomUUID } from 'node:crypto';
import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from '@sniptail/core/acp/types.js';
import { logger } from '@sniptail/core/logger.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { BotEventSink } from '../channels/botEventSink.js';
import type { Notifier } from '../channels/notifier.js';
import {
  buildPermissionRequestEvent,
  publishPermissionUpdated,
} from '../agent-command/interactiveAgentEvents.js';

type AgentResponse = CoreWorkerEvent<'agent.session.start'>['payload']['response'];

type PendingPermissionDisplayState = 'queued' | 'visible' | 'reply_sent';

type PendingAcpPermission = {
  sessionId: string;
  interactionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  request: AcpRequestPermissionRequest;
  expiresAt: string;
  displayState: PendingPermissionDisplayState;
  allowAlways: boolean;
  requestEvent: ReturnType<typeof buildPermissionRequestEvent>;
  timeout: NodeJS.Timeout;
  resolveResult: (result: AcpRequestPermissionResponse) => void;
};

type RequestAcpPermissionInput = {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
  request: AcpRequestPermissionRequest;
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

const pendingPermissions = new Map<string, PendingAcpPermission>();
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

function cancelledPermissionResponse(): AcpRequestPermissionResponse {
  return {
    outcome: {
      outcome: 'cancelled',
    },
  };
}

function getPendingPermission(
  sessionId: string,
  interactionId: string,
): PendingAcpPermission | undefined {
  return pendingPermissions.get(pendingInteractionKey(sessionId, interactionId));
}

function deletePendingPermission(permission: PendingAcpPermission): void {
  pendingPermissions.delete(pendingInteractionKey(permission.sessionId, permission.interactionId));
  clearTimeout(permission.timeout);

  const order = pendingPermissionOrder.get(permission.sessionId) ?? [];
  const nextOrder = order.filter((interactionId) => interactionId !== permission.interactionId);
  if (nextOrder.length > 0) {
    pendingPermissionOrder.set(permission.sessionId, nextOrder);
  } else {
    pendingPermissionOrder.delete(permission.sessionId);
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

function findOptionByKind(
  options: AcpRequestPermissionRequest['options'],
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always',
) {
  return options.find((option) => option.kind === kind);
}

function buildPermissionResponseForDecision(
  request: AcpRequestPermissionRequest,
  decision: Extract<
    CoreWorkerEvent<'agent.interaction.resolve'>['payload']['resolution'],
    { kind: 'permission' }
  >['decision'],
): AcpRequestPermissionResponse | undefined {
  const option =
    decision === 'once'
      ? findOptionByKind(request.options, 'allow_once')
      : decision === 'always'
        ? findOptionByKind(request.options, 'allow_always')
        : (findOptionByKind(request.options, 'reject_once') ??
          findOptionByKind(request.options, 'reject_always'));

  if (!option) {
    return undefined;
  }

  return {
    outcome: {
      outcome: 'selected',
      optionId: option.optionId,
    },
  };
}

function permissionDecisionStatus(
  decision: Extract<
    CoreWorkerEvent<'agent.interaction.resolve'>['payload']['resolution'],
    { kind: 'permission' }
  >['decision'],
): 'approved_once' | 'approved_always' | 'rejected' {
  if (decision === 'always') return 'approved_always';
  if (decision === 'reject') return 'rejected';
  return 'approved_once';
}

function summarizeRawInput(rawInput: unknown): string | undefined {
  if (rawInput === undefined) {
    return undefined;
  }

  const serialized = JSON.stringify(rawInput);
  if (!serialized) {
    return undefined;
  }

  return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
}

function buildPermissionDetails(request: AcpRequestPermissionRequest): string[] {
  const details: string[] = [`Tool call: ${request.toolCall.toolCallId}`];
  if (request.toolCall.kind) {
    details.push(`Kind: ${request.toolCall.kind}`);
  }
  for (const location of request.toolCall.locations ?? []) {
    details.push(
      `Location: ${location.path}${typeof location.line === 'number' ? `:${location.line}` : ''}`,
    );
  }
  const rawInput = summarizeRawInput(request.toolCall.rawInput);
  if (rawInput) {
    details.push(`Input: ${rawInput}`);
  }
  return details;
}

function toolNameFromRequest(request: AcpRequestPermissionRequest): string | undefined {
  return request.toolCall.kind ?? (request.toolCall.title ? 'tool' : undefined);
}

function buildActionLabel(request: AcpRequestPermissionRequest): string | undefined {
  return request.toolCall.title || undefined;
}

function supportsSniptailPermissionBridge(request: AcpRequestPermissionRequest): boolean {
  return (
    findOptionByKind(request.options, 'allow_once') !== undefined &&
    (findOptionByKind(request.options, 'reject_once') !== undefined ||
      findOptionByKind(request.options, 'reject_always') !== undefined)
  );
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
  deletePendingPermission(pending);
  pending.resolveResult(cancelledPermissionResponse());

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

export async function requestAcpPermission(
  input: RequestAcpPermissionInput,
): Promise<AcpRequestPermissionResponse> {
  if (!supportsSniptailPermissionBridge(input.request)) {
    logger.warn(
      {
        sessionId: input.sessionId,
        workspaceKey: input.workspaceKey,
        toolCallId: input.request.toolCall.toolCallId,
        toolTitle: input.request.toolCall.title,
        optionKinds: input.request.options.map((option) => option.kind),
      },
      'ACP permission request is not compatible with the current Sniptail permission UI',
    );
    return cancelledPermissionResponse();
  }

  return await new Promise<AcpRequestPermissionResponse>((resolveResult) => {
    const interactionId = randomUUID();
    const expiresAt = new Date(Date.now() + input.timeoutMs).toISOString();
    const requestEvent = buildPermissionRequestEvent({
      response: input.response,
      sessionId: input.sessionId,
      interactionId,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(toolNameFromRequest(input.request)
        ? { toolName: toolNameFromRequest(input.request) }
        : {}),
      ...(buildActionLabel(input.request) ? { action: buildActionLabel(input.request) } : {}),
      details: buildPermissionDetails(input.request),
      expiresAt,
      allowAlways: findOptionByKind(input.request.options, 'allow_always') !== undefined,
    });
    const pending: PendingAcpPermission = {
      sessionId: input.sessionId,
      interactionId,
      response: input.response,
      workspaceKey: input.workspaceKey,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      request: input.request,
      expiresAt,
      displayState: 'queued',
      allowAlways: findOptionByKind(input.request.options, 'allow_always') !== undefined,
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

    pendingPermissions.set(pendingInteractionKey(input.sessionId, interactionId), pending);
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
        'Failed to publish ACP permission request',
      );
      const current = getPendingPermission(input.sessionId, interactionId);
      if (!current) {
        return;
      }
      deletePendingPermission(current);
      current.resolveResult(cancelledPermissionResponse());
    });
  });
}

export async function resolveAcpPermissionInteraction({
  event,
  notifier,
  botEvents,
}: ResolveInput): Promise<void> {
  const { sessionId, interactionId, resolution, response } = event.payload;
  const ref = buildRef(response);
  const pending = getPendingPermission(sessionId, interactionId);

  if (!pending) {
    await notifier.postMessage(ref, 'This agent interaction is no longer pending.');
    return;
  }

  if (resolution.kind !== 'permission') {
    await notifier.postMessage(
      ref,
      'This agent interaction no longer matches the selected control.',
    );
    return;
  }

  if (pending.displayState === 'reply_sent') {
    await notifier.postMessage(ref, 'This agent permission is already being resolved.');
    return;
  }
  if (pending.displayState !== 'visible') {
    await notifier.postMessage(ref, 'This agent permission is not currently displayed.');
    return;
  }
  if (resolution.decision === 'always' && !pending.allowAlways) {
    await notifier.postMessage(
      ref,
      'This agent interaction no longer matches the selected control.',
    );
    return;
  }

  const permissionResponse = buildPermissionResponseForDecision(
    pending.request,
    resolution.decision,
  );
  if (!permissionResponse) {
    await notifier.postMessage(
      ref,
      'This agent interaction no longer matches the selected control.',
    );
    return;
  }

  pending.displayState = 'reply_sent';
  deletePendingPermission(pending);
  pending.resolveResult(permissionResponse);

  await publishPermissionUpdated({
    botEvents,
    response: pending.response,
    sessionId,
    interactionId,
    status: permissionDecisionStatus(resolution.decision),
    ...(response.userId ? { actorUserId: response.userId } : {}),
    ...(resolution.message ? { message: resolution.message } : {}),
  });
  await publishPromotedPermission({ sessionId, botEvents });
}

export async function clearAcpPermissionInteractions({
  sessionId,
  botEvents,
  message = 'Agent session ended before this interaction was resolved.',
}: ClearInput): Promise<void> {
  const stale: PendingAcpPermission[] = [];

  for (const pending of pendingPermissions.values()) {
    if (pending.sessionId === sessionId) {
      stale.push(pending);
    }
  }

  for (const pending of stale) {
    deletePendingPermission(pending);
    pending.resolveResult(cancelledPermissionResponse());
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
  }
}

export function buildAcpPermissionHandler(input: {
  sessionId: string;
  response: AgentResponse;
  workspaceKey: string;
  cwd?: string;
  timeoutMs: number;
  botEvents: BotEventSink;
}) {
  return async (request: AcpRequestPermissionRequest) =>
    await requestAcpPermission({
      ...input,
      request,
    });
}
