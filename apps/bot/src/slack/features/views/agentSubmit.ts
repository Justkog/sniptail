import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  createAgentSession,
  updateAgentSessionStatus,
} from '@sniptail/core/agent-sessions/registry.js';
import { upsertSlackAgentDefaults } from '@sniptail/core/agent-defaults/registry.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import type { JobContextFile } from '@sniptail/core/types/job.js';
import { getAgentCommandMetadata } from '../../../agentCommandMetadataCache.js';
import { buildSlackAgentStopBlocks } from '../../agentCommandState.js';
import { loadSlackModalContextFiles, postMessage } from '../../helpers.js';
import { buildAgentSessionStartWorkerEvent } from '../../../agentCommandShared.js';
import type { SlackHandlerContext } from '../context.js';
import { authorizeSlackOperationAndRespond } from '../../permissions/slackPermissionGuards.js';
import { auditAgentSessionStart } from '../../../lib/requestAudit.js';

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalConfigString(value: string | null | undefined): string | undefined {
  return normalizeOptionalString(value);
}

function validateRelativeCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (isAbsolute(cwd)) {
    throw new Error('`cwd` must be a relative path.');
  }
  return cwd;
}

export function registerAgentSubmitView({
  app,
  slackIds,
  config,
  workerEventQueue,
  permissions,
}: SlackHandlerContext) {
  app.view(slackIds.actions.agentSubmit, async ({ ack, body, view, client }) => {
    await ack();

    const metadata = getAgentCommandMetadata();
    const privateMetadata = view.private_metadata
      ? (JSON.parse(view.private_metadata) as {
          channelId: string;
          userId: string;
          threadId?: string;
          workspaceId?: string;
        })
      : undefined;
    const channelId = privateMetadata?.channelId ?? body.user.id;
    const userId = privateMetadata?.userId ?? body.user.id;
    const existingThreadId = privateMetadata?.threadId;
    const workspaceId = privateMetadata?.workspaceId;
    const state = view.state.values;
    const prompt = state.prompt?.prompt?.value?.trim();
    const baseAuditInput = {
      provider: 'slack' as const,
      channelId,
      userId,
      requestText: prompt ?? '',
      contextFileCount: 0,
      ...(existingThreadId ? { threadId: existingThreadId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };

    if (!metadata?.enabled) {
      auditAgentSessionStart(config, baseAuditInput, 'invalid');
      await postMessage(app, {
        channel: channelId,
        text: 'Agent sessions are not available yet. Please try again in a few seconds.',
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }

    const workspaceKey = state.workspace?.workspace_key?.selected_option?.value?.trim();
    const profileKey = state.profile?.agent_profile_key?.selected_option?.value?.trim();
    const cwd = validateRelativeCwd(normalizeOptionalString(state.cwd?.cwd?.value));

    if (!prompt) {
      auditAgentSessionStart(config, baseAuditInput, 'invalid');
      await postMessage(app, {
        channel: channelId,
        text: 'The prompt cannot be empty.',
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }
    if (!workspaceKey || !metadata.workspaces.some((workspace) => workspace.key === workspaceKey)) {
      auditAgentSessionStart(config, baseAuditInput, 'invalid');
      await postMessage(app, {
        channel: channelId,
        text: 'Please choose a valid workspace.',
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }
    if (!profileKey || !metadata.profiles.some((profile) => profile.key === profileKey)) {
      auditAgentSessionStart(config, baseAuditInput, 'invalid');
      await postMessage(app, {
        channel: channelId,
        text: 'Please choose a valid agent profile.',
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }

    let contextFiles: JobContextFile[] | undefined;
    try {
      const uploadedFiles = await loadSlackModalContextFiles({
        client,
        botToken: normalizeOptionalConfigString(config.slack?.botToken),
        state,
      });
      contextFiles = uploadedFiles.length ? uploadedFiles : undefined;
    } catch (err) {
      auditAgentSessionStart(
        config,
        {
          ...baseAuditInput,
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
        },
        'persist_failed',
      );
      logger.warn({ err }, 'Failed to load Slack modal context files for agent session');
      await postMessage(app, {
        channel: channelId,
        text: `I couldn't use the uploaded files: ${(err as Error).message}`,
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }

    const sessionId = randomUUID();
    const controlText = [
      `Agent session requested by <@${userId}>.`,
      '',
      '```',
      prompt,
      '```',
      `Workspace: \`${workspaceKey}\``,
      `Profile: \`${profileKey}\``,
      cwd ? `CWD: \`${cwd}\`` : undefined,
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    let controlMessageTs: string | undefined;
    try {
      const controlMessage = await postMessage(app, {
        channel: channelId,
        text: controlText,
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: controlText,
            },
          },
          ...buildSlackAgentStopBlocks(slackIds.actions.agentStop, sessionId),
        ],
        ...(contextFiles?.length ? { contextFiles } : {}),
      });
      controlMessageTs = controlMessage.ts;
    } catch (err) {
      auditAgentSessionStart(
        config,
        {
          ...baseAuditInput,
          sessionId,
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
          contextFileCount: contextFiles?.length ?? 0,
        },
        'persist_failed',
      );
      logger.error({ err }, 'Failed to post Slack agent control message');
      await postMessage(app, {
        channel: channelId,
        text: `Failed to create the agent session control message: ${(err as Error).message}`,
        ...(existingThreadId ? { threadTs: existingThreadId } : {}),
      });
      return;
    }

    const threadId = existingThreadId ?? controlMessageTs;
    if (!threadId) {
      auditAgentSessionStart(
        config,
        {
          ...baseAuditInput,
          sessionId,
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
          contextFileCount: contextFiles?.length ?? 0,
        },
        'persist_failed',
      );
      await postMessage(app, {
        channel: channelId,
        text: 'Failed to determine the Slack thread for this agent session.',
      });
      return;
    }

    const event = buildAgentSessionStartWorkerEvent({
      session: {
        sessionId,
        provider: 'slack',
        channelId,
        threadId,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        workspaceKey,
        agentProfileKey: profileKey,
        ...(cwd ? { cwd } : {}),
      },
      prompt,
      ...(contextFiles?.length ? { contextFiles } : {}),
    });

    try {
      await createAgentSession({
        sessionId,
        provider: 'slack',
        channelId,
        threadId,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        workspaceKey,
        agentProfileKey: profileKey,
        ...(cwd ? { cwd } : {}),
        status: 'pending',
      });
    } catch (err) {
      auditAgentSessionStart(
        config,
        {
          sessionId,
          provider: 'slack',
          channelId,
          threadId,
          userId,
          requestText: prompt,
          contextFileCount: contextFiles?.length ?? 0,
          ...(workspaceId ? { workspaceId } : {}),
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
        },
        'persist_failed',
      );
      logger.error({ err, sessionId }, 'Failed to create Slack agent session record');
      await postMessage(app, {
        channel: channelId,
        text: `Failed to create the session record: ${(err as Error).message}`,
        ...(threadId ? { threadTs: threadId } : {}),
      });
      return;
    }

    let denied = false;
    const authorized = await authorizeSlackOperationAndRespond({
      permissions,
      client: app.client,
      slackIds,
      action: 'agent.start',
      summary: `Start agent session in workspace ${workspaceKey} | profile ${profileKey}`,
      operation: {
        kind: 'enqueueWorkerEvent',
        event,
      },
      actor: {
        userId,
        channelId,
        threadId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      onDeny: async () => {
        denied = true;
        await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
          logger.warn(
            { err: updateErr, sessionId },
            'Failed to mark denied Slack agent session as failed',
          );
        });
        await postMessage(app, {
          channel: channelId,
          text: 'You are not authorized to start agent sessions.',
          ...(threadId ? { threadTs: threadId } : {}),
        });
      },
      pendingApprovalText: 'Agent session request submitted for approval.',
      approvalPresentation: 'approval_only',
    });
    if (!authorized) {
      auditAgentSessionStart(
        config,
        {
          sessionId,
          provider: 'slack',
          channelId,
          threadId,
          userId,
          requestText: prompt,
          contextFileCount: contextFiles?.length ?? 0,
          ...(workspaceId ? { workspaceId } : {}),
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
        },
        denied ? 'stopped' : 'pending',
      );
      return;
    }

    try {
      await enqueueWorkerEvent(workerEventQueue, event);
      await upsertSlackAgentDefaults({
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        workspaceKey,
        agentProfileKey: profileKey,
        ...(cwd ? { cwd } : {}),
      }).catch((err) => {
        logger.warn({ err, sessionId, userId }, 'Failed to persist Slack agent defaults');
      });
      await updateAgentSessionStatus(sessionId, 'active');
      auditAgentSessionStart(
        config,
        {
          sessionId,
          provider: 'slack',
          channelId,
          threadId,
          userId,
          requestText: prompt,
          contextFileCount: contextFiles?.length ?? 0,
          ...(workspaceId ? { workspaceId } : {}),
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
        },
        'accepted',
      );
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to enqueue Slack agent session start event');
      await updateAgentSessionStatus(sessionId, 'failed').catch((updateErr) => {
        logger.warn({ err: updateErr, sessionId }, 'Failed to mark Slack agent session as failed');
      });
      auditAgentSessionStart(
        config,
        {
          sessionId,
          provider: 'slack',
          channelId,
          threadId,
          userId,
          requestText: prompt,
          contextFileCount: contextFiles?.length ?? 0,
          ...(workspaceId ? { workspaceId } : {}),
          workspaceKey,
          agentProfileKey: profileKey,
          ...(cwd ? { cwd } : {}),
        },
        'persist_failed',
      );
      await postMessage(app, {
        channel: channelId,
        text: `Failed to start the session: ${(err as Error).message}`,
        ...(threadId ? { threadTs: threadId } : {}),
      });
    }
  });
}
