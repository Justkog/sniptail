import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeSlackOperationAndRespond } from './slackPermissionGuards.js';

type SlackClient = {
  chat: {
    postMessage: ReturnType<typeof vi.fn>;
  };
};

function createPermissionsMock() {
  return {
    authorizeOrCreateApproval: vi.fn(),
    buildApprovalMessage: vi.fn(),
    assignApprovalThreadIfPending: vi.fn(),
    getGroupCacheTtlMs: vi.fn(() => 10_000),
  };
}

const slackIds = {
  actions: {
    approvalApprove: 'approval-approve',
    approvalDeny: 'approval-deny',
    approvalCancel: 'approval-cancel',
  },
} as const;

describe('Slack approval guard flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts job request then approval in the same existing thread', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-1' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.explore`.');
    const postMessage = vi.fn().mockResolvedValue({});
    const client: SlackClient = {
      chat: {
        postMessage,
      },
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions: permissions as never,
      client: client as never,
      slackIds: slackIds as never,
      action: 'jobs.explore',
      summary: 'Queue explore job explore-1',
      operation: {
        kind: 'enqueueJob',
        job: {
          jobId: 'explore-1',
          type: 'EXPLORE',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Check repo history',
          channel: {
            provider: 'slack',
            channelId: 'C1',
            userId: 'U1',
            threadId: 'thread-1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'C1',
        threadId: 'thread-1',
      },
      onDeny: vi.fn(),
    });

    expect(authorized).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: 'C1',
        thread_ts: 'thread-1',
        text: '*Job request*\n```\nCheck repo history\n```',
      }),
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channel: 'C1',
        thread_ts: 'thread-1',
        text: 'Approval required for `jobs.explore`.',
      }),
    );
    expect(permissions.assignApprovalThreadIfPending).not.toHaveBeenCalled();
  });

  it('posts job request first and threads approval when command is not in a thread', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-2' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.ask`.');
    permissions.assignApprovalThreadIfPending.mockResolvedValue(true);
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ts: 'request-root-ts' })
      .mockResolvedValueOnce({});
    const client: SlackClient = {
      chat: {
        postMessage,
      },
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions: permissions as never,
      client: client as never,
      slackIds: slackIds as never,
      action: 'jobs.ask',
      summary: 'Queue ask job ask-1',
      operation: {
        kind: 'enqueueJob',
        job: {
          jobId: 'ask-1',
          type: 'ASK',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'How does this work?',
          channel: {
            provider: 'slack',
            channelId: 'C1',
            userId: 'U1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'C1',
      },
      onDeny: vi.fn(),
    });

    expect(authorized).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: 'C1',
        text: '*Job request*\n```\nHow does this work?\n```',
      }),
    );
    expect(permissions.assignApprovalThreadIfPending).toHaveBeenCalledWith({
      approvalId: 'approval-2',
      threadId: 'request-root-ts',
    });
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channel: 'C1',
        thread_ts: 'request-root-ts',
        text: 'Approval required for `jobs.ask`.',
      }),
    );
  });

  it('uses operation summary as request text for non-job approval operations', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-3' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.clearBefore`.');
    const postMessage = vi.fn().mockResolvedValue({});
    const client: SlackClient = {
      chat: {
        postMessage,
      },
    };

    await authorizeSlackOperationAndRespond({
      permissions: permissions as never,
      client: client as never,
      slackIds: slackIds as never,
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
        channelId: 'C1',
        threadId: 'thread-2',
      },
      onDeny: vi.fn(),
    });

    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: 'C1',
        thread_ts: 'thread-2',
        text: '*Job request*\n```\nClear jobs before 2025-01-01T00:00:00.000Z\n```',
      }),
    );
  });

  it('approval_only posts only the approval message and skips pending/job request messages', async () => {
    const permissions = createPermissionsMock();
    permissions.authorizeOrCreateApproval.mockResolvedValue({
      status: 'require_approval',
      request: { id: 'approval-mention-1' },
    });
    permissions.buildApprovalMessage.mockReturnValue('Approval required for `jobs.mention`.');
    const postMessage = vi.fn().mockResolvedValue({});
    const onRequireApprovalNotice = vi.fn();
    const client: SlackClient = {
      chat: {
        postMessage,
      },
    };

    const authorized = await authorizeSlackOperationAndRespond({
      permissions: permissions as never,
      client: client as never,
      slackIds: slackIds as never,
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
            provider: 'slack',
            channelId: 'C1',
            userId: 'U1',
            threadId: 'thread-mention-1',
          },
        },
      },
      actor: {
        userId: 'U1',
        channelId: 'C1',
        threadId: 'thread-mention-1',
      },
      onDeny: vi.fn(),
      onRequireApprovalNotice,
      approvalPresentation: 'approval_only',
    });

    expect(authorized).toBe(false);
    expect(onRequireApprovalNotice).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C1',
        thread_ts: 'thread-mention-1',
        text: 'Approval required for `jobs.mention`.',
      }),
    );
    expect(permissions.assignApprovalThreadIfPending).not.toHaveBeenCalled();
  });
});
