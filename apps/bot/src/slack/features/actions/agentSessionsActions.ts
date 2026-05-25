import { randomUUID } from 'node:crypto';
import { createAgentSession } from '@sniptail/core/agent-sessions/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerMailboxEvent } from '@sniptail/core/queue/queue.js';
import { createJobId } from '../../../lib/jobs.js';
import {
  buildSlackAgentActionValue,
  parseSlackAgentActionValue,
  setPendingSlackAgentSessionBrowserRequest,
  type SlackAgentSessionsAttachActionPayload,
  type SlackAgentSessionsPageActionPayload,
} from '../../agentCommandState.js';
import {
  loadAgentCommandMetadata,
  type AgentCommandMetadata,
} from '../../../agentCommandMetadataCache.js';
import type { SlackHandlerContext } from '../context.js';
import {
  authorizeSlackOperationAndRespond,
  authorizeSlackPrecheckAndRespond,
} from '../../permissions/slackPermissionGuards.js';
import { postMessage } from '../../helpers.js';
import {
  buildAgentSessionsListWorkerEvent,
  findWorkerProfile,
  validateRelativeCwd,
  validateSlackAgentSessionsSelection,
} from '../../agentSessionsShared.js';

function matchesRequester(
  payload: { userId: string; channelId: string; workspaceId?: string },
  body: { userId?: string; channelId?: string; workspaceId?: string },
): boolean {
  return (
    payload.userId === body.userId &&
    payload.channelId === body.channelId &&
    payload.workspaceId === body.workspaceId
  );
}

function resolveActionContext(body: {
  channel?: { id?: string };
  user?: { id?: string };
  team?: { id?: string } | null;
}): { channelId?: string; userId?: string; workspaceId?: string } {
  const channelId = body.channel?.id;
  const userId = body.user?.id;
  const workspaceId = body.team?.id;
  return {
    ...(channelId ? { channelId } : {}),
    ...(userId ? { userId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function buildListSummary(payload: SlackAgentSessionsPageActionPayload): string {
  return payload.agentProfileKey
    ? `Browse sessions for ${payload.agentProfileKey} on worker ${payload.workerId}`
    : `Browse sessions on worker ${payload.workerId}`;
}

function resolveLiveWorkerOrThrow(
  metadata: AgentCommandMetadata,
  workerId: string,
  agentProfileKey?: string,
  filters?: SlackAgentSessionsPageActionPayload['filters'],
) {
  const { worker } = validateSlackAgentSessionsSelection({
    metadata,
    workerId,
    ...(agentProfileKey ? { agentProfileKey } : {}),
    ...(filters ? { filters } : {}),
  });
  return worker;
}

async function enqueuePageRequest(input: {
  context: SlackHandlerContext;
  client: SlackHandlerContext['app']['client'];
  actor: { channelId: string; userId: string; workspaceId?: string };
  sourceThreadId?: string;
  payload: SlackAgentSessionsPageActionPayload;
  cursor?: string;
  currentCursor?: string;
  cursorHistory: string[];
}) {
  const requestId = createJobId('agent-sessions');
  const event = buildAgentSessionsListWorkerEvent({
    requestId,
    channelId: input.actor.channelId,
    userId: input.actor.userId,
    ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
    ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}),
    workerId: input.payload.workerId,
    ...(input.payload.agentProfileKey ? { agentProfileKey: input.payload.agentProfileKey } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.payload.filters ? { filters: input.payload.filters } : {}),
  });

  const authorized = await authorizeSlackOperationAndRespond({
    permissions: input.context.permissions,
    client: input.client,
    slackIds: input.context.slackIds,
    action: 'agent.start',
    summary: buildListSummary(input.payload),
    operation: {
      kind: 'enqueueWorkerEvent',
      event,
      targetWorkerId: input.payload.workerId,
    },
    actor: {
      userId: input.actor.userId,
      channelId: input.actor.channelId,
      ...(input.sourceThreadId ? { threadId: input.sourceThreadId } : {}),
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
    },
    onDeny: async () => {
      await input.client.chat.postEphemeral({
        channel: input.actor.channelId,
        user: input.actor.userId,
        text: 'You are not authorized to browse agent sessions.',
      });
    },
    onRequireApprovalNotice: async (message) => {
      await input.client.chat.postEphemeral({
        channel: input.actor.channelId,
        user: input.actor.userId,
        text: message,
      });
    },
    approvalPresentation: 'approval_only',
  });
  if (!authorized) {
    return;
  }

  setPendingSlackAgentSessionBrowserRequest({
    requestId,
    channelId: input.actor.channelId,
    userId: input.actor.userId,
    ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
    ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}),
    workerId: input.payload.workerId,
    ...(input.payload.agentProfileKey ? { agentProfileKey: input.payload.agentProfileKey } : {}),
    ...(input.payload.filters ? { filters: input.payload.filters } : {}),
    ...(input.currentCursor ? { currentCursor: input.currentCursor } : {}),
    cursorHistory: input.cursorHistory,
  });

  await input.client.chat.postEphemeral({
    channel: input.actor.channelId,
    user: input.actor.userId,
    text: 'Loading agent sessions...',
  });

  await enqueueWorkerMailboxEvent(input.context.queueRuntime, input.payload.workerId, event);
}

function registerPageAction(
  actionId: string,
  direction: 'previous' | 'next',
  context: SlackHandlerContext,
) {
  const { app } = context;
  app.action(actionId, async ({ ack, body, client, action }) => {
    await ack();
    const payload = parseSlackAgentActionValue<SlackAgentSessionsPageActionPayload>(
      (action as { value?: string }).value,
    );
    const actor = resolveActionContext(body);
    if (!payload || !actor.channelId || !actor.userId || !matchesRequester(payload, actor)) {
      if (actor.channelId && actor.userId) {
        await client.chat.postEphemeral({
          channel: actor.channelId,
          user: actor.userId,
          text: 'This session browser action belongs to a different user.',
        });
      }
      return;
    }
    const resolvedActor = {
      channelId: actor.channelId,
      userId: actor.userId,
      ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
    };

    const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
      logger.error({ err }, 'Failed to refresh agent command metadata for Slack pagination');
      return undefined;
    });
    if (!metadata?.enabled) {
      await client.chat.postEphemeral({
        channel: actor.channelId,
        user: actor.userId,
        text: 'Agent sessions are not available yet. Please try again in a few seconds.',
      });
      return;
    }

    try {
      resolveLiveWorkerOrThrow(
        metadata,
        payload.workerId,
        payload.agentProfileKey,
        payload.filters,
      );
    } catch (err) {
      await client.chat.postEphemeral({
        channel: actor.channelId,
        user: actor.userId,
        text: `${(err as Error).message} Refresh the session list.`,
      });
      return;
    }

    try {
      if (direction === 'next') {
        if (!payload.nextCursor) {
          await client.chat.postEphemeral({
            channel: actor.channelId,
            user: actor.userId,
            text: 'No later page is available.',
          });
          return;
        }
        await enqueuePageRequest({
          context,
          client,
          actor: resolvedActor,
          ...(payload.sourceThreadId ? { sourceThreadId: payload.sourceThreadId } : {}),
          payload,
          cursor: payload.nextCursor,
          currentCursor: payload.nextCursor,
          cursorHistory: payload.currentCursor
            ? [...payload.cursorHistory, payload.currentCursor]
            : [...payload.cursorHistory],
        });
        return;
      }

      const previousCursor = payload.previousCursor ?? payload.cursorHistory.at(-1);
      await enqueuePageRequest({
        context,
        client,
        actor: resolvedActor,
        ...(payload.sourceThreadId ? { sourceThreadId: payload.sourceThreadId } : {}),
        payload,
        ...(previousCursor ? { cursor: previousCursor, currentCursor: previousCursor } : {}),
        cursorHistory: payload.cursorHistory.slice(0, -1),
      });
    } catch (err) {
      logger.error(
        { err, direction, workerId: payload.workerId },
        'Failed Slack session pagination',
      );
      await client.chat.postEphemeral({
        channel: actor.channelId,
        user: actor.userId,
        text: 'Failed to change the session page. Please try again shortly.',
      });
    }
  });
}

export function registerAgentSessionsActions(context: SlackHandlerContext) {
  registerPageAction(context.slackIds.actions.agentSessionsPrevious, 'previous', context);
  registerPageAction(context.slackIds.actions.agentSessionsNext, 'next', context);

  context.app.action(
    context.slackIds.actions.agentSessionsAttach,
    async ({ ack, body, client, action }) => {
      await ack();

      const payload = parseSlackAgentActionValue<SlackAgentSessionsAttachActionPayload>(
        (action as { value?: string }).value,
      );
      const actor = resolveActionContext(body);
      if (!payload || !actor.channelId || !actor.userId || !matchesRequester(payload, actor)) {
        if (actor.channelId && actor.userId) {
          await client.chat.postEphemeral({
            channel: actor.channelId,
            user: actor.userId,
            text: 'This session browser action belongs to a different user.',
          });
        }
        return;
      }
      const resolvedActor = {
        channelId: actor.channelId,
        userId: actor.userId,
        ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
      };

      const authorized = await authorizeSlackPrecheckAndRespond({
        permissions: context.permissions,
        client,
        action: 'agent.start',
        actor: {
          userId: resolvedActor.userId,
          channelId: resolvedActor.channelId,
          ...(payload.sourceThreadId ? { threadId: payload.sourceThreadId } : {}),
          ...(resolvedActor.workspaceId ? { workspaceId: resolvedActor.workspaceId } : {}),
        },
        onDeny: async () => {
          await client.chat.postEphemeral({
            channel: resolvedActor.channelId,
            user: resolvedActor.userId,
            text: 'You are not authorized to attach agent sessions.',
          });
        },
      });
      if (!authorized) {
        return;
      }

      const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
        logger.error({ err }, 'Failed to refresh agent command metadata for Slack attach');
        return undefined;
      });
      if (!metadata?.enabled) {
        await client.chat.postEphemeral({
          channel: resolvedActor.channelId,
          user: resolvedActor.userId,
          text: 'Agent sessions are not available yet. Please try again in a few seconds.',
        });
        return;
      }

      let worker;
      try {
        worker = resolveLiveWorkerOrThrow(
          metadata,
          payload.workerId,
          payload.sessionAgentProfileKey,
          payload.filters,
        );
      } catch (err) {
        await client.chat.postEphemeral({
          channel: resolvedActor.channelId,
          user: resolvedActor.userId,
          text: `${(err as Error).message} Refresh the session list.`,
        });
        return;
      }

      const profile = findWorkerProfile(worker, payload.sessionAgentProfileKey);
      if (!profile || profile.provider !== payload.provider) {
        await client.chat.postEphemeral({
          channel: resolvedActor.channelId,
          user: resolvedActor.userId,
          text: 'The selected session profile is no longer available on that worker. Refresh the session list.',
        });
        return;
      }

      const workspaceKey =
        payload.workspaceKey?.trim() ||
        payload.filters?.workspaceKey?.trim() ||
        context.config.agentCommand?.defaultWorkspace?.trim();
      if (!workspaceKey || !worker.workspaces.some((workspace) => workspace.key === workspaceKey)) {
        await client.chat.postEphemeral({
          channel: resolvedActor.channelId,
          user: resolvedActor.userId,
          text: 'The selected session does not have a valid workspace selector for attach.',
        });
        return;
      }

      let cwd: string | undefined;
      try {
        cwd = validateRelativeCwd(payload.cwd ?? payload.filters?.cwd);
      } catch {
        cwd = undefined;
      }

      try {
        const seedText = [
          `Attached previous ${payload.provider} session \`${payload.providerSessionId}\`.`,
          payload.title ? `Title: ${payload.title}` : undefined,
          `Profile: \`${payload.sessionAgentProfileKey}\``,
          `Workspace: \`${workspaceKey}\`${cwd ? ` / ${cwd}` : ''}`,
          'Reply in this thread to continue the attached session.',
        ]
          .filter((line) => line !== undefined)
          .join('\n');

        const seedMessage = await postMessage(context.app, {
          channel: resolvedActor.channelId,
          text: seedText,
          ...(payload.sourceThreadId ? { threadTs: payload.sourceThreadId } : {}),
        });
        const threadId = payload.sourceThreadId ?? seedMessage.ts;
        if (!threadId) {
          throw new Error('Failed to determine the Slack thread for this attached session.');
        }

        const now = new Date();
        await createAgentSession({
          sessionId: randomUUID(),
          provider: 'slack',
          channelId: resolvedActor.channelId,
          threadId,
          userId: resolvedActor.userId,
          ...(resolvedActor.workspaceId ? { workspaceId: resolvedActor.workspaceId } : {}),
          workspaceKey,
          agentProfileKey: payload.sessionAgentProfileKey,
          codingAgentSessionId: payload.providerSessionId,
          ...(cwd ? { cwd } : {}),
          ownerWorkerId: worker.workerId,
          ...(worker.workerLabel ? { ownerWorkerLabel: worker.workerLabel } : {}),
          workerClaimedAt: now.toISOString(),
          status: 'completed',
          now,
        });
      } catch (err) {
        logger.error({ err, workerId: payload.workerId }, 'Failed to attach Slack agent session');
        await client.chat.postEphemeral({
          channel: resolvedActor.channelId,
          user: resolvedActor.userId,
          text: `Failed to attach the selected session: ${(err as Error).message}`,
        });
      }
    },
  );
}

export function buildSlackAgentSessionsPageValue(
  payload: SlackAgentSessionsPageActionPayload,
): string {
  return buildSlackAgentActionValue(payload);
}

export function buildSlackAgentSessionsAttachValue(
  payload: SlackAgentSessionsAttachActionPayload,
): string {
  return buildSlackAgentActionValue(payload);
}
