import { randomUUID } from 'node:crypto';
import type { JobRecord } from '../jobs/registryTypes.js';
import { getJobRegistryStore } from '../jobs/registryStore.js';
import type {
  ApprovalRequest,
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
    await upsert(expired);
    return makeTransitionResult(expired, true, 'expired');
  }

  const resolved: ApprovalRequest = {
    ...request,
    status: input.resolution,
    resolution: input.resolution,
    resolvedAt: now.toISOString(),
    ...(input.resolvedByUserId ? { resolvedBy: { userId: input.resolvedByUserId } } : {}),
  };
  await upsert(resolved);
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
