import { randomUUID } from 'node:crypto';
import type { JobRecord } from '../jobs/registryTypes.js';
import { getJobRegistryStore } from '../jobs/registryStore.js';
import type {
  ApprovalRequest,
  ApprovalRequestContext,
  ApprovalResolution,
  ApprovalTransitionResult,
} from './permissionsApprovalTypes.js';

const APPROVAL_KEY_PREFIX = 'approval:';

function approvalKey(id: string): string {
  return `${APPROVAL_KEY_PREFIX}${id}`;
}

function asApprovalRequest(value: unknown): ApprovalRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<ApprovalRequest>;
  if (!record.id || !record.status || !record.action || !record.provider || !record.context) {
    return undefined;
  }
  if (!record.requestedBy || !record.operation) {
    return undefined;
  }
  if (!record.createdAt || !record.expiresAt || !record.summary) {
    return undefined;
  }
  return record as ApprovalRequest;
}

async function loadById(id: string): Promise<ApprovalRequest | undefined> {
  const store = await getJobRegistryStore();
  const record = await store.loadRecordByKey(approvalKey(id));
  return asApprovalRequest(record);
}

async function upsert(request: ApprovalRequest): Promise<void> {
  const store = await getJobRegistryStore();
  await store.upsertRecord(approvalKey(request.id), request as unknown as JobRecord);
}

async function conditionalUpsert(
  id: string,
  updated: ApprovalRequest,
  requiredStatus: ApprovalRequest['status'],
): Promise<boolean> {
  const store = await getJobRegistryStore();
  return store.conditionalUpdateRecord(approvalKey(id), updated as unknown as JobRecord, {
    statusEquals: requiredStatus,
  });
}

function makeTransitionResult(
  request: ApprovalRequest | undefined,
  changed: boolean,
  reason: ApprovalTransitionResult['reason'],
): ApprovalTransitionResult {
  return {
    ...(request ? { request } : {}),
    changed,
    reason,
  };
}

async function resolveIfPending(input: {
  id: string;
  resolution: ApprovalResolution;
  resolvedByUserId?: string;
  now?: Date;
}): Promise<ApprovalTransitionResult> {
  const request = await loadById(input.id);
  if (!request) {
    return makeTransitionResult(undefined, false, 'not_found');
  }
  if (request.status !== 'pending') {
    return makeTransitionResult(request, false, 'not_pending');
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(request.expiresAt);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    const expired: ApprovalRequest = {
      ...request,
      status: 'expired',
      resolution: 'expired',
      resolvedAt: now.toISOString(),
    };
    const changed = await conditionalUpsert(request.id, expired, 'pending');
    if (!changed) {
      return makeTransitionResult(request, false, 'not_pending');
    }
    return makeTransitionResult(expired, true, 'expired');
  }

  const resolved: ApprovalRequest = {
    ...request,
    status: input.resolution,
    resolution: input.resolution,
    resolvedAt: now.toISOString(),
    ...(input.resolvedByUserId ? { resolvedBy: { userId: input.resolvedByUserId } } : {}),
  };
  const changed = await conditionalUpsert(request.id, resolved, 'pending');
  if (!changed) {
    return makeTransitionResult(request, false, 'not_pending');
  }
  return makeTransitionResult(resolved, true, 'updated');
}

export async function createApprovalRequest(input: {
  base: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'>;
  ttlSeconds: number;
  now?: Date;
}): Promise<ApprovalRequest> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
  const request: ApprovalRequest = {
    ...input.base,
    id: randomUUID(),
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  await upsert(request);
  return request;
}

export async function loadApprovalRequest(id: string): Promise<ApprovalRequest | undefined> {
  return loadById(id);
}

export async function listPendingApprovalRequests(): Promise<ApprovalRequest[]> {
  const store = await getJobRegistryStore();
  const records = await store.loadAllRecordsByPrefix(APPROVAL_KEY_PREFIX);
  return records
    .map((record) => asApprovalRequest(record))
    .filter((record): record is ApprovalRequest => Boolean(record))
    .filter((record) => record.status === 'pending');
}

export async function approveIfPending(
  id: string,
  resolvedByUserId: string,
): Promise<ApprovalTransitionResult> {
  return resolveIfPending({ id, resolution: 'approved', resolvedByUserId });
}

export async function denyIfPending(
  id: string,
  resolvedByUserId: string,
): Promise<ApprovalTransitionResult> {
  return resolveIfPending({ id, resolution: 'denied', resolvedByUserId });
}

export async function cancelIfPending(
  id: string,
  resolvedByUserId: string,
): Promise<ApprovalTransitionResult> {
  return resolveIfPending({ id, resolution: 'cancelled', resolvedByUserId });
}

export async function expireIfPending(
  id: string,
  now = new Date(),
): Promise<ApprovalTransitionResult> {
  return resolveIfPending({ id, resolution: 'expired', now });
}

export async function assignThreadIdIfPending(
  id: string,
  threadId: string,
): Promise<ApprovalTransitionResult> {
  return assignApprovalContextIfPending(id, { threadId });
}

export async function assignApprovalContextIfPending(
  id: string,
  contextPatch: {
    channelId?: ApprovalRequestContext['channelId'];
    threadId?: ApprovalRequestContext['threadId'];
  },
  options?: {
    updateOperationRouting?: boolean;
  },
): Promise<ApprovalTransitionResult> {
  const request = await loadById(id);
  if (!request) {
    return makeTransitionResult(undefined, false, 'not_found');
  }
  if (request.status !== 'pending') {
    return makeTransitionResult(request, false, 'not_pending');
  }

  const nextContext: ApprovalRequestContext = {
    ...request.context,
    ...(contextPatch.channelId ? { channelId: contextPatch.channelId } : {}),
    ...(contextPatch.threadId ? { threadId: contextPatch.threadId } : {}),
  };
  const updateOperationRouting = options?.updateOperationRouting ?? true;
  const nextOperation = updateOperationRouting
    ? request.operation.kind === 'enqueueJob'
      ? {
          ...request.operation,
          job: {
            ...request.operation.job,
            channel: {
              ...request.operation.job.channel,
              ...(contextPatch.channelId ? { channelId: contextPatch.channelId } : {}),
              ...(contextPatch.threadId ? { threadId: contextPatch.threadId } : {}),
            },
          },
        }
      : request.operation.kind === 'enqueueBootstrap'
        ? {
            ...request.operation,
            request: {
              ...request.operation.request,
              channel: {
                ...request.operation.request.channel,
                ...(contextPatch.channelId ? { channelId: contextPatch.channelId } : {}),
                ...(contextPatch.threadId ? { threadId: contextPatch.threadId } : {}),
              },
            },
          }
        : request.operation
    : request.operation;

  const contextUnchanged =
    nextContext.channelId === request.context.channelId &&
    nextContext.threadId === request.context.threadId;
  const operationRoutingUnchanged = updateOperationRouting
    ? request.operation.kind === 'enqueueJob'
      ? (!contextPatch.channelId ||
          request.operation.job.channel.channelId === contextPatch.channelId) &&
        (!contextPatch.threadId || request.operation.job.channel.threadId === contextPatch.threadId)
      : request.operation.kind === 'enqueueBootstrap'
        ? (!contextPatch.channelId ||
            request.operation.request.channel.channelId === contextPatch.channelId) &&
          (!contextPatch.threadId ||
            request.operation.request.channel.threadId === contextPatch.threadId)
        : true
    : true;
  if (contextUnchanged && operationRoutingUnchanged) {
    return makeTransitionResult(request, false, 'unchanged');
  }

  const updated: ApprovalRequest = {
    ...request,
    context: nextContext,
    operation: nextOperation,
  };
  const changed = await conditionalUpsert(request.id, updated, 'pending');
  if (!changed) {
    return makeTransitionResult(request, false, 'not_pending');
  }
  return makeTransitionResult(updated, true, 'updated');
}
