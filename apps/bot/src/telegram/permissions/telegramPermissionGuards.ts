import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { WORKER_EVENT_SCHEMA_VERSION } from '@sniptail/core/types/worker-event.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type { DeferredPermissionOperation } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import type { QueuePublisher } from '@sniptail/core/queue/queueTransportTypes.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { PermissionsRuntimeService } from '../../permissions/permissionsRuntimeService.js';
import { buildTelegramApprovalKeyboard } from '../helpers.js';
import { editTelegramMessage, sendTelegramMessage } from '../lib/messageEditing.js';
import type { Bot } from 'grammy';

export async function authorizeTelegramOperationAndRespond(input: {
  bot: Bot;
  permissions: PermissionsRuntimeService;
  action: PermissionAction;
  summary: string;
  operation: DeferredPermissionOperation;
  userId: string;
  channelId: string;
  threadId?: string;
  onDeny: (message: string) => Promise<void>;
  onRequireApprovalNotice?: (message: string) => Promise<void>;
  approvalMessageId?: number;
}): Promise<boolean> {
  const authorization = await input.permissions.authorizeOrCreateApproval({
    action: input.action,
    provider: 'telegram',
    userId: input.userId,
    channelId: input.channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    summary: input.summary,
    operation: input.operation,
  });
  if (authorization.status === 'allow') {
    return true;
  }
  if (authorization.status === 'deny') {
    await input.onDeny('You are not authorized to perform this action.');
    return false;
  }

  const text = input.permissions.buildApprovalMessage('telegram', authorization.request);
  const keyboard = buildTelegramApprovalKeyboard(authorization.request.id);
  const routingThreadId = String(input.approvalMessageId ?? '');
  if (input.approvalMessageId) {
    await input.permissions.assignApprovalContextIfPending({
      approvalId: authorization.request.id,
      threadId: routingThreadId,
      updateOperationRouting: true,
    });
    await editTelegramMessage(input.bot, input.channelId, input.approvalMessageId, text, keyboard);
  } else {
    const approvalMessageId = await sendTelegramMessage(input.bot, input.channelId, text, keyboard);
    if (approvalMessageId) {
      await input.permissions.assignApprovalContextIfPending({
        approvalId: authorization.request.id,
        threadId: String(approvalMessageId),
        updateOperationRouting: true,
      });
    }
  }
  if (input.onRequireApprovalNotice) {
    await input.onRequireApprovalNotice(
      'Approval required. I posted approval controls in this chat.',
    );
  }
  return false;
}

export async function enqueueTelegramUsageRequest(input: {
  bot: Bot;
  workerEventQueue: QueuePublisher<WorkerEvent>;
  permissions: PermissionsRuntimeService;
  userId: string;
  channelId: string;
  threadId?: string;
  replyMessageId: number;
}): Promise<void> {
  const event: WorkerEvent = {
    schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
    type: 'status.codexUsage',
    payload: {
      provider: 'telegram',
      channelId: input.channelId,
      userId: input.userId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  };

  const authorized = await authorizeTelegramOperationAndRespond({
    bot: input.bot,
    permissions: input.permissions,
    action: 'status.codexUsage',
    summary: 'Check Codex usage status',
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
    },
    userId: input.userId,
    channelId: input.channelId,
    threadId: String(input.replyMessageId),
    approvalMessageId: input.replyMessageId,
    onDeny: async (message) => {
      await editTelegramMessage(input.bot, input.channelId, input.replyMessageId, message);
    },
    onRequireApprovalNotice: async (message) => {
      await sendTelegramMessage(
        input.bot,
        input.channelId,
        message,
        undefined,
        input.replyMessageId,
      );
    },
  });
  if (!authorized) {
    return;
  }

  await enqueueWorkerEvent(input.workerEventQueue, event);
  await editTelegramMessage(
    input.bot,
    input.channelId,
    input.replyMessageId,
    'Checking Codex usage...',
  );
}

export async function resolveTelegramApprovalCallback(input: {
  bot: Bot;
  permissions: PermissionsRuntimeService;
  approvalId: string;
  resolutionAction: 'approval.grant' | 'approval.deny' | 'approval.cancel';
  userId: string;
  channelId: string;
  messageId: number;
  threadId?: string;
}): Promise<void> {
  const result = await input.permissions.resolveApprovalInteraction({
    action: input.resolutionAction,
    resolutionAction: input.resolutionAction,
    approvalId: input.approvalId,
    provider: 'telegram',
    userId: input.userId,
    channelId: input.channelId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
  });

  if (result.status === 'approved' || result.status === 'denied' || result.status === 'cancelled') {
    const text = input.permissions.buildApprovalResolutionMessage({
      provider: 'telegram',
      request: result.request,
      status: result.status,
      message: result.message,
    });
    await editTelegramMessage(input.bot, input.channelId, input.messageId, text);
    return;
  }

  await sendTelegramMessage(input.bot, input.channelId, result.message, undefined, input.messageId);
}
