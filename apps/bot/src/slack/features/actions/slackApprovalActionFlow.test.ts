import { describe, expect, it, vi } from 'vitest';
import { registerApprovalActions } from './approvalActions.js';

type RegisteredActionHandler = (args: {
  ack: () => Promise<void>;
  action: { value?: string };
  body: {
    user?: { id?: string };
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string };
    team?: { id?: string };
  };
}) => Promise<void>;

function createSlackContext() {
  const handlers = new Map<string, RegisteredActionHandler>();
  const client = {
    chat: {
      update: vi.fn().mockResolvedValue({}),
      postEphemeral: vi.fn().mockResolvedValue({}),
    },
  };
  const app = {
    client,
    action: vi.fn((actionId: string, handler: RegisteredActionHandler) => {
      handlers.set(actionId, handler);
    }),
  };
  const resolveApprovalInteraction = vi.fn<
    (input: { threadId?: string }) => Promise<{
      status: 'approved';
      message: string;
      request: { id: string };
      executed: boolean;
    }>
  >();
  const buildApprovalResolutionMessage =
    vi.fn<
      (input: {
        provider: 'slack';
        request: { id: string };
        status: 'approved';
        message: string;
      }) => string
    >();
  const permissions = {
    resolveApprovalInteraction,
    buildApprovalResolutionMessage,
    getGroupCacheTtlMs: vi.fn(() => 1_000),
  };
  const slackIds = {
    actions: {
      approvalApprove: 'approval-approve',
      approvalDeny: 'approval-deny',
      approvalCancel: 'approval-cancel',
    },
  };

  registerApprovalActions({
    app,
    permissions,
    slackIds,
  } as never);

  return { handlers, client, permissions };
}

describe('Slack approval action flow', () => {
  it('edits message with structured resolution and does not infer thread id from top-level ts', async () => {
    const { handlers, client, permissions } = createSlackContext();
    const approveHandler = handlers.get('approval-approve');
    if (!approveHandler) {
      throw new Error('Expected approve handler registration.');
    }

    permissions.resolveApprovalInteraction.mockResolvedValue({
      status: 'approved',
      message: 'Request approved and executed.',
      request: {
        id: 'approval-1',
      },
      executed: true,
    });
    permissions.buildApprovalResolutionMessage.mockReturnValue(
      'Request approved and executed.\nJob type: jobs.ask\nRequester: <@U_REQ>\nSummary: Queue ask job ask-1\nApproved by: <@U_APP>',
    );

    const ack = vi.fn().mockResolvedValue(undefined);
    await approveHandler({
      ack,
      action: { value: 'approval-1' },
      body: {
        user: { id: 'U_APP' },
        channel: { id: 'C1' },
        message: { ts: '111.222' },
        team: { id: 'T1' },
      },
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(permissions.resolveApprovalInteraction).toHaveBeenCalledTimes(1);
    const resolveInput = permissions.resolveApprovalInteraction.mock.calls[0]?.[0];
    expect(resolveInput?.threadId).toBeUndefined();

    expect(permissions.buildApprovalResolutionMessage).toHaveBeenCalledWith({
      provider: 'slack',
      request: { id: 'approval-1' },
      status: 'approved',
      message: 'Request approved and executed.',
    });
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '111.222',
      text: 'Request approved and executed.\nJob type: jobs.ask\nRequester: <@U_REQ>\nSummary: Queue ask job ask-1\nApproved by: <@U_APP>',
      blocks: [],
    });
    expect(client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: 'C1',
      user: 'U_APP',
      text: 'Request approved and executed.',
    });
  });
});
