import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeDiscordOperationAndRespond } from './discordPermissionGuards.js';
import { isSendableTextChannel, postDiscordMessage } from '../helpers.js';

vi.mock('../helpers.js', () => ({
  postDiscordMessage: vi.fn(),
  isSendableTextChannel: vi.fn(() => true),
}));

function createPermissionsMock() {
  return {
    authorizeOrCreateApproval: vi.fn(),
    buildApprovalMessage: vi.fn(),
    assignApprovalContextIfPending: vi.fn(),
  };
}

describe('Discord approval guard flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts job request then approval in the same existing thread', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-1' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.plan`.');

    const authorized = await authorizeDiscordOperationAndRespond({
      permissions: permissions as never,
      action: 'jobs.plan',
      summary: 'Queue plan job plan-1',
      operation: {
        kind: 'enqueueJob',
        job: {
          jobId: 'plan-1',
          type: 'PLAN',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Plan a migration',
          channel: {
            provider: 'discord',
            channelId: 'D1',
            userId: 'U1',
            threadId: 'thread-1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'D1',
        threadId: 'thread-1',
      },
      client: {} as never,
      onDeny: vi.fn(),
    });

    expect(authorized).toBe(false);
    expect(postDiscordMessage).toHaveBeenCalledTimes(2);
    expect(postDiscordMessage).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        channelId: 'D1',
        threadId: 'thread-1',
        text: '**Job request**\n```\nPlan a migration\n```',
      }),
    );
    expect(postDiscordMessage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        channelId: 'D1',
        threadId: 'thread-1',
        text: 'Approval required for `jobs.plan`.',
      }),
    );
    expect(permissions.assignApprovalContextIfPending).not.toHaveBeenCalled();
  });

  it('posts top-level request, creates thread, then posts approval in that thread', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-2' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.clearBefore`.');
    permissions.assignApprovalContextIfPending.mockResolvedValue(true);

    const startThread = vi.fn().mockResolvedValue({ id: 'thread-created' });
    const send = vi.fn().mockResolvedValue({ startThread });
    const fetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      send,
    });
    const client = {
      channels: {
        fetch,
      },
    };

    const authorized = await authorizeDiscordOperationAndRespond({
      permissions: permissions as never,
      action: 'jobs.clearBefore',
      summary: 'Clear jobs before 2025-01-01T00:00:00.000Z',
      operation: {
        kind: 'enqueueWorkerEvent',
        event: {
          schemaVersion: 1,
          type: 'jobs.clearBefore',
          payload: {
            cutoffIso: '2025-01-01T00:00:00.000Z',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'D1',
      },
      client: client as never,
      onDeny: vi.fn(),
    });

    expect(authorized).toBe(false);
    expect(isSendableTextChannel).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      content: '**Job request**\n```\nClear jobs before 2025-01-01T00:00:00.000Z\n```',
    });
    const threadOptions = startThread.mock.calls[0]?.[0] as { name?: string } | undefined;
    expect(threadOptions?.name).toBe('sniptail approval approval-2');
    expect(permissions.assignApprovalContextIfPending).toHaveBeenCalledWith({
      approvalId: 'approval-2',
      channelId: 'thread-created',
      threadId: 'thread-created',
    });
    expect(postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(postDiscordMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        channelId: 'D1',
        threadId: 'thread-created',
        text: 'Approval required for `jobs.clearBefore`.',
      }),
    );
  });

  it('approval_only posts only approval in resolved thread and skips pending/job request messages', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-mention-1' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.mention`.');
    permissions.assignApprovalContextIfPending.mockResolvedValue(true);
    const onRequireApprovalNotice = vi.fn();
    const resolveApprovalThreadId = vi.fn().mockResolvedValue('thread-from-mention');
    const client = {} as never;

    const authorized = await authorizeDiscordOperationAndRespond({
      permissions: permissions as never,
      action: 'jobs.mention',
      summary: 'Queue mention job mention-1',
      operation: {
        kind: 'enqueueJob',
        job: {
          jobId: 'mention-1',
          type: 'MENTION',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Please summarize this thread.',
          channel: {
            provider: 'discord',
            channelId: 'D1',
            userId: 'U1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'D1',
      },
      client,
      onDeny: vi.fn(),
      onRequireApprovalNotice,
      approvalPresentation: 'approval_only',
      resolveApprovalThreadId,
    });

    expect(authorized).toBe(false);
    expect(onRequireApprovalNotice).not.toHaveBeenCalled();
    expect(resolveApprovalThreadId).toHaveBeenCalledWith('approval-mention-1');
    expect(permissions.assignApprovalContextIfPending).toHaveBeenCalledWith({
      approvalId: 'approval-mention-1',
      channelId: 'thread-from-mention',
      threadId: 'thread-from-mention',
      updateOperationRouting: false,
    });
    expect(postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(postDiscordMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        channelId: 'D1',
        threadId: 'thread-from-mention',
        text: 'Approval required for `jobs.mention`.',
      }),
    );
    expect(isSendableTextChannel).not.toHaveBeenCalled();
  });

  it('approval_only falls back to channel when thread resolver fails', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-mention-2' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.mention`.');
    const resolveApprovalThreadId = vi.fn().mockResolvedValue(undefined);
    const onRequireApprovalNotice = vi.fn();
    const client = {} as never;

    const authorized = await authorizeDiscordOperationAndRespond({
      permissions: permissions as never,
      action: 'jobs.mention',
      summary: 'Queue mention job mention-2',
      operation: {
        kind: 'enqueueJob',
        job: {
          jobId: 'mention-2',
          type: 'MENTION',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Please summarize this thread.',
          channel: {
            provider: 'discord',
            channelId: 'D1',
            userId: 'U1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'D1',
      },
      client,
      onDeny: vi.fn(),
      onRequireApprovalNotice,
      approvalPresentation: 'approval_only',
      resolveApprovalThreadId,
    });

    expect(authorized).toBe(false);
    expect(onRequireApprovalNotice).not.toHaveBeenCalled();
    expect(resolveApprovalThreadId).toHaveBeenCalledWith('approval-mention-2');
    expect(permissions.assignApprovalContextIfPending).not.toHaveBeenCalled();
    expect(postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(postDiscordMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        channelId: 'D1',
        text: 'Approval required for `jobs.mention`.',
      }),
    );
    expect(isSendableTextChannel).not.toHaveBeenCalled();
  });
});
