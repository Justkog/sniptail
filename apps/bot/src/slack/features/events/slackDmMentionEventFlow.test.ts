import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAppMentionEvent } from './appMention.js';
import { registerDmMentionEvent } from './dmMentionEvent.js';

const enqueueJobMock = vi.hoisted(() => vi.fn());
const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const refreshRepoAllowlistMock = vi.hoisted(() => vi.fn());
const authorizeSlackOperationAndRespondMock = vi.hoisted(() => vi.fn());
const addReactionMock = vi.hoisted(() => vi.fn());
const postMessageMock = vi.hoisted(() => vi.fn());
const fetchSlackThreadContextMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('../../../lib/repoAllowlist.js', () => ({
  refreshRepoAllowlist: refreshRepoAllowlistMock,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: authorizeSlackOperationAndRespondMock,
}));

vi.mock('../../helpers.js', () => ({
  addReaction: addReactionMock,
  postMessage: postMessageMock,
}));

vi.mock('../../lib/threadContext.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/threadContext.js')>(
    '../../lib/threadContext.js',
  );
  return {
    ...actual,
    fetchSlackThreadContext: fetchSlackThreadContextMock,
  };
});

type EventHandler = (args: { event: Record<string, unknown>; client: SlackClient }) => Promise<void>;

type SlackClient = {
  auth: {
    test: ReturnType<typeof vi.fn>;
  };
};

function createSlackContext() {
  const handlers = new Map<string, EventHandler>();
  const client: SlackClient = {
    auth: {
      test: vi.fn().mockResolvedValue({
        user_id: 'UBOT',
        bot_id: 'BBOT',
        team_id: 'T1',
      }),
    },
  };
  const app = {
    client,
    event: vi.fn((eventName: string, handler: EventHandler) => {
      handlers.set(eventName, handler);
    }),
  };
  const context = {
    app,
    client,
    config: {
      botName: 'JC.exe',
      primaryAgent: 'codex',
      repoAllowlist: {
        'repo-1': { baseBranch: 'experimental' },
        'repo-2': { baseBranch: 'develop' },
      },
    },
    queue: {},
    permissions: {},
    slackIds: {},
  } as never;

  registerAppMentionEvent(context);
  registerDmMentionEvent(context);

  return { app, client, context, handlers };
}

describe('Slack DM mention event flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueJobMock.mockResolvedValue(undefined);
    saveJobQueuedMock.mockResolvedValue(undefined);
    refreshRepoAllowlistMock.mockResolvedValue(undefined);
    authorizeSlackOperationAndRespondMock.mockResolvedValue(true);
    addReactionMock.mockResolvedValue(undefined);
    postMessageMock.mockResolvedValue(undefined);
    fetchSlackThreadContextMock.mockResolvedValue(undefined);
  });

  it('queues a mention job for a root IM mention and anchors replies to event ts', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> hello there',
        ts: '111.222',
        user: 'U1',
      },
    });

    expect(authorizeSlackOperationAndRespondMock).toHaveBeenCalledTimes(1);
    const authInput = authorizeSlackOperationAndRespondMock.mock.calls[0]?.[0];
    expect(authInput.actor).toEqual({
      userId: 'U1',
      channelId: 'D1',
      threadId: '111.222',
    });
    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MENTION',
        gitRef: 'experimental',
        requestText: 'hello there',
        channel: expect.objectContaining({
          provider: 'slack',
          channelId: 'D1',
          userId: 'U1',
          threadId: '111.222',
        }),
      }),
    );
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  it('queues a mention job for a threaded IM mention using thread_ts', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> continue',
        ts: '111.333',
        thread_ts: '111.222',
        user: 'U1',
      },
    });

    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({
          threadId: '111.222',
        }),
      }),
    );
  });

  it('queues a mention job for MPIM mentions', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'G1',
        channel_type: 'mpim',
        text: '<@UBOT> group hello',
        ts: '222.111',
        user: 'U2',
      },
    });

    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({
          channelId: 'G1',
          threadId: '222.111',
        }),
      }),
    );
  });

  it('ignores root and threaded IM/MPIM messages without explicit mentions', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: 'hello there',
        ts: '111.222',
        user: 'U1',
      },
    });
    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'G1',
        channel_type: 'mpim',
        text: 'still no mention',
        ts: '111.333',
        thread_ts: '111.222',
        user: 'U1',
      },
    });

    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('ignores channel message events', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'C1',
        channel_type: 'channel',
        text: '<@UBOT> hello',
        ts: '111.222',
        user: 'U1',
      },
    });

    expect(saveJobQueuedMock).not.toHaveBeenCalled();
  });

  it('ignores bot and subtype message events', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> hello',
        ts: '111.222',
        user: 'U1',
        bot_id: 'B1',
      },
    });
    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> hello',
        ts: '111.223',
        user: 'U1',
        subtype: 'message_changed',
      },
    });

    expect(saveJobQueuedMock).not.toHaveBeenCalled();
  });

  it('uses fallback request text when the DM only contains a mention token', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT>',
        ts: '111.224',
        user: 'U1',
      },
    });

    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestText: 'Say hello and ask how you can help.',
      }),
    );
  });

  it('posts approval and deny notices in the anchored DM thread', async () => {
    const { handlers } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    authorizeSlackOperationAndRespondMock.mockImplementationOnce(async (input) => {
      await input.onDeny();
      return false;
    });

    await messageHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> denied',
        ts: '111.225',
        user: 'U1',
      },
    });

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        channel: 'D1',
        text: 'You are not authorized to mention this bot in DMs for jobs.',
        threadTs: '111.225',
      },
    );
  });

  it('caches Slack runtime identity across DM mention events', async () => {
    const { handlers, client } = createSlackContext();
    const messageHandler = handlers.get('message');
    if (!messageHandler) throw new Error('Expected message handler registration.');

    await messageHandler({
      client: client as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> first',
        ts: '111.222',
        user: 'U1',
      },
    });
    await messageHandler({
      client: client as never,
      event: {
        channel: 'D1',
        channel_type: 'im',
        text: '<@UBOT> second',
        ts: '111.223',
        user: 'U1',
      },
    });

    expect(client.auth.test).toHaveBeenCalledTimes(1);
  });

  it('keeps channel app_mention behavior unchanged', async () => {
    const { handlers } = createSlackContext();
    const appMentionHandler = handlers.get('app_mention');
    if (!appMentionHandler) throw new Error('Expected app_mention handler registration.');

    await appMentionHandler({
      client: { auth: { test: vi.fn() } } as never,
      event: {
        channel: 'C1',
        text: '<@UBOT> hello',
        ts: '333.111',
        user: 'U1',
      },
    });

    expect(addReactionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        channel: 'C1',
        name: 'eyes',
        timestamp: '333.111',
      },
    );
    expect(saveJobQueuedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({
          channelId: 'C1',
          threadId: '333.111',
        }),
      }),
    );
  });
});
