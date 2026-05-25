import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerMailboxEvent } from '@sniptail/core/queue/queue.js';
import { createJobId } from '../../../lib/jobs.js';
import { dedupe } from '../../lib/dedupe.js';
import {
  clearPendingSlackAgentSessionBrowserRequest,
  setPendingSlackAgentSessionBrowserRequest,
} from '../../agentCommandState.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { loadAgentCommandMetadata } from '../../../agentCommandMetadataCache.js';
import {
  buildAgentSessionsCommandUsage,
  buildAgentSessionsListWorkerEvent,
  parseAgentSessionsCommandText,
  validateSlackAgentSessionsSelection,
} from '../../agentSessionsShared.js';

const LOADING_MESSAGE = 'Loading agent sessions...';

export function registerAgentSessionsCommand({
  app,
  slackIds,
  queueRuntime,
  permissions,
}: SlackHandlerContext) {
  app.command(slackIds.commands.agentSessions, async ({ ack, body, client }) => {
    const userId = body.user_id;
    if (!userId) {
      return;
    }

    const dedupeKey = `${body.team_id}:${body.trigger_id}:agent-sessions`;
    if (dedupe(dedupeKey)) {
      await ack();
      return;
    }

    let parsedCommand;
    try {
      parsedCommand = parseAgentSessionsCommandText(body.text ?? '');
    } catch (err) {
      await ack({
        response_type: 'ephemeral',
        text: `${(err as Error).message}\n${buildAgentSessionsCommandUsage(slackIds.commands.agentSessions)}`,
      });
      return;
    }

    const metadata = await loadAgentCommandMetadata({ forceRefresh: true }).catch((err) => {
      logger.error({ err }, 'Failed to load agent command metadata for Slack session browser');
      return undefined;
    });
    if (!metadata?.enabled) {
      await ack({
        response_type: 'ephemeral',
        text: 'Agent sessions are not available yet. Please try again in a few seconds.',
      });
      return;
    }

    let workerId = parsedCommand.workerId;
    try {
      ({
        worker: { workerId },
      } = validateSlackAgentSessionsSelection({
        metadata,
        workerId: parsedCommand.workerId,
        ...(parsedCommand.agentProfileKey
          ? { agentProfileKey: parsedCommand.agentProfileKey }
          : {}),
        ...(parsedCommand.filters ? { filters: parsedCommand.filters } : {}),
      }));
    } catch (err) {
      await ack({
        response_type: 'ephemeral',
        text: (err as Error).message,
      });
      return;
    }

    const requestId = createJobId('agent-sessions');
    const sourceThreadId = (body.thread_ts as string | undefined)?.trim() || undefined;
    const event = buildAgentSessionsListWorkerEvent({
      requestId,
      channelId: body.channel_id,
      userId,
      workspaceId: body.team_id,
      ...(sourceThreadId ? { sourceThreadId } : {}),
      workerId,
      ...(parsedCommand.agentProfileKey ? { agentProfileKey: parsedCommand.agentProfileKey } : {}),
      ...(parsedCommand.filters ? { filters: parsedCommand.filters } : {}),
    });

    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client,
      slackIds,
      action: 'agent.start',
      summary: `Browse agent sessions on worker ${workerId}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
        targetWorkerId: workerId,
      },
      actor: {
        userId,
        channelId: body.channel_id,
        ...(sourceThreadId ? { threadId: sourceThreadId } : {}),
        workspaceId: body.team_id,
      },
      onDeny: async () => {
        await ack({
          response_type: 'ephemeral',
          text: 'You are not authorized to browse agent sessions.',
        });
      },
      onRequireApprovalNotice: async (message) => {
        await ack({
          response_type: 'ephemeral',
          text: message,
        });
      },
    });
    if (!authorized) {
      return;
    }

    await ack({
      response_type: 'ephemeral',
      text: LOADING_MESSAGE,
    });

    setPendingSlackAgentSessionBrowserRequest({
      requestId,
      channelId: body.channel_id,
      userId,
      workspaceId: body.team_id,
      ...(sourceThreadId ? { sourceThreadId } : {}),
      workerId,
      ...(parsedCommand.agentProfileKey ? { agentProfileKey: parsedCommand.agentProfileKey } : {}),
      ...(parsedCommand.filters ? { filters: parsedCommand.filters } : {}),
      cursorHistory: [],
    });

    try {
      await enqueueWorkerMailboxEvent(queueRuntime, workerId, event);
    } catch (err) {
      clearPendingSlackAgentSessionBrowserRequest(requestId);
      logger.error({ err, requestId, workerId }, 'Failed to enqueue Slack agent sessions list');
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: userId,
        text: 'Failed to request the session list. Please try again shortly.',
      });
    }
  });
}
