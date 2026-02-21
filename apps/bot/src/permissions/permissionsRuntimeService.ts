import type { Queue } from 'bullmq';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { enqueueBootstrap, enqueueJob, enqueueWorkerEvent } from '@sniptail/core/queue/queue.js';
import {
  approveIfPending,
  cancelIfPending,
  createApprovalRequest,
  denyIfPending,
  expireIfPending,
  loadApprovalRequest,
} from '@sniptail/core/permissions/permissionsApprovalStore.js';
import type {
  ApprovalRequest,
  DeferredPermissionOperation,
} from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { evaluatePermissionDecision } from '@sniptail/core/permissions/permissionsPolicyEngine.js';
import type { PermissionAction } from '@sniptail/core/permissions/permissionsActionCatalog.js';
import type {
  PermissionActor,
  PermissionDecision,
  PermissionSubject,
} from '@sniptail/core/permissions/permissionsPolicyTypes.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { ChannelProvider } from '@sniptail/core/types/channel.js';
import { resolvePermissionsProviderCapabilities } from './permissionsProviderCapabilities.js';

type RuntimeDeps = {
  config: BotConfig;
  queue: Queue<JobSpec>;
  bootstrapQueue: Queue<BootstrapRequest>;
  workerEventQueue: Queue<WorkerEvent>;
};

type AuthorizationInput = {
  action: PermissionAction;
  provider: ChannelProvider;
  userId: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  guildId?: string;
  groupIds?: string[];
  resolveGroups?: (candidateGroupIds: string[]) => Promise<string[]>;
};

export type AuthorizationResult = {
  decision: PermissionDecision;
  allowed: boolean;
  requiresApproval: boolean;
};

export type ApprovalInteractionResult =
  | {
      status: 'not_found' | 'already_resolved' | 'forbidden' | 'expired';
      message: string;
      request?: ApprovalRequest;
    }
  | {
      status: 'approved' | 'denied' | 'cancelled';
      message: string;
      request: ApprovalRequest;
      executed: boolean;
    };

export class PermissionsRuntimeService {
  readonly #config: BotConfig;
  readonly #queue: Queue<JobSpec>;
  readonly #bootstrapQueue: Queue<BootstrapRequest>;
  readonly #workerEventQueue: Queue<WorkerEvent>;

  constructor(deps: RuntimeDeps) {
    this.#config = deps.config;
    this.#queue = deps.queue;
    this.#bootstrapQueue = deps.bootstrapQueue;
    this.#workerEventQueue = deps.workerEventQueue;
  }

  getGroupCacheTtlMs(): number {
    return this.#config.permissions.groupCacheTtlSeconds * 1000;
  }

  async authorize(input: AuthorizationInput): Promise<AuthorizationResult> {
    const decision = await this.#evaluate(input);
    return {
      decision,
      allowed: decision.effect === 'allow',
      requiresApproval: decision.effect === 'require_approval',
    };
  }

  async authorizeOrCreateApproval(
    input: AuthorizationInput & {
      summary: string;
      operation: DeferredPermissionOperation;
    },
  ): Promise<
    | {
        status: 'allow';
        decision: PermissionDecision;
      }
    | {
        status: 'deny';
        decision: PermissionDecision;
      }
    | {
        status: 'require_approval';
        decision: PermissionDecision;
        request: ApprovalRequest;
      }
  > {
    const decision = await this.#evaluate(input);
    if (decision.effect === 'allow') {
      return {
        status: 'allow',
        decision,
      };
    }
    if (decision.effect === 'deny') {
      return {
        status: 'deny',
        decision,
      };
    }
    const request = await createApprovalRequest({
      base: {
        action: input.action,
        provider: input.provider,
        context: {
          provider: input.provider,
          channelId: input.channelId,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          ...(input.guildId ? { guildId: input.guildId } : {}),
        },
        requestedBy: {
          userId: input.userId,
        },
        approverSubjects: decision.approverSubjects,
        notifySubjects: decision.notifySubjects,
        operation: input.operation,
        summary: input.summary,
        ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
      },
      ttlSeconds: this.#config.permissions.approvalTtlSeconds,
    });
    return {
      status: 'require_approval',
      decision,
      request,
    };
  }

  async resolveApprovalInteraction(
    input: AuthorizationInput & {
      approvalId: string;
      resolutionAction: 'approval.grant' | 'approval.deny' | 'approval.cancel';
    },
  ): Promise<ApprovalInteractionResult> {
    const request = await loadApprovalRequest(input.approvalId);
    if (!request) {
      return {
        status: 'not_found',
        message: 'Approval request not found.',
      };
    }

    if (request.status !== 'pending') {
      return {
        status: 'already_resolved',
        message: `Approval request is already ${request.status}.`,
        request,
      };
    }

    if (!this.#matchesContext(request, input)) {
      return {
        status: 'forbidden',
        message: 'This approval must be resolved in the same context.',
        request,
      };
    }

    const expiresAt = new Date(request.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      const expired = await expireIfPending(request.id);
      return {
        status: 'expired',
        message: 'Approval request has expired.',
        ...(expired.request ? { request: expired.request } : {}),
      };
    }

    if (input.resolutionAction === 'approval.cancel') {
      if (request.requestedBy.userId !== input.userId) {
        const cancelAuth = await this.authorize({
          ...input,
          action: 'approval.cancel',
        });
        if (!cancelAuth.allowed) {
          return {
            status: 'forbidden',
            message: 'You are not authorized to cancel this approval request.',
            request,
          };
        }
      }
      const cancelled = await cancelIfPending(request.id, input.userId);
      if (!cancelled.request) {
        return {
          status: 'not_found',
          message: 'Approval request not found.',
        };
      }
      return {
        status: 'cancelled',
        message: 'Approval request cancelled.',
        request: cancelled.request,
        executed: false,
      };
    }

    if (
      input.resolutionAction === 'approval.grant' &&
      request.requestedBy.userId === input.userId
    ) {
      return {
        status: 'forbidden',
        message: 'You cannot approve your own request.',
        request,
      };
    }

    const approvalAction =
      input.resolutionAction === 'approval.grant' ? 'approval.grant' : 'approval.deny';
    const auth = await this.authorize({
      ...input,
      action: approvalAction,
    });
    if (!auth.allowed) {
      return {
        status: 'forbidden',
        message: `You are not authorized to ${approvalAction === 'approval.grant' ? 'approve' : 'deny'} this request.`,
        request,
      };
    }

    if (approvalAction === 'approval.deny') {
      const denied = await denyIfPending(request.id, input.userId);
      if (!denied.request) {
        return {
          status: 'not_found',
          message: 'Approval request not found.',
        };
      }
      return {
        status: 'denied',
        message: 'Approval request denied.',
        request: denied.request,
        executed: false,
      };
    }

    const approved = await approveIfPending(request.id, input.userId);
    if (!approved.request) {
      return {
        status: 'not_found',
        message: 'Approval request not found.',
      };
    }

    let executed = false;
    try {
      await this.executeDeferredOperation(approved.request.operation);
      executed = true;
    } catch (err) {
      logger.error(
        { err, approvalId: approved.request.id },
        'Failed to execute approved operation',
      );
      return {
        status: 'approved',
        message: 'Request approved, but execution failed. Please check logs.',
        request: approved.request,
        executed: false,
      };
    }

    return {
      status: 'approved',
      message: 'Request approved and executed.',
      request: approved.request,
      executed,
    };
  }

  async executeDeferredOperation(operation: DeferredPermissionOperation): Promise<void> {
    switch (operation.kind) {
      case 'enqueueJob':
        await enqueueJob(this.#queue, operation.job);
        return;
      case 'enqueueBootstrap':
        await enqueueBootstrap(this.#bootstrapQueue, operation.request);
        return;
      case 'enqueueWorkerEvent':
        await enqueueWorkerEvent(this.#workerEventQueue, operation.event);
        return;
      default: {
        const exhaustive: never = operation;
        throw new Error(`Unsupported deferred operation: ${String(exhaustive)}`);
      }
    }
  }

  renderSubjectMentions(provider: ChannelProvider, subjects: PermissionSubject[]): string[] {
    const capabilities = resolvePermissionsProviderCapabilities(provider);
    if (!capabilities.subjectMentions) {
      return [];
    }
    return subjects
      .map((subject) => this.#renderSubjectMention(provider, subject))
      .filter((mention): mention is string => Boolean(mention));
  }

  buildApprovalMessage(provider: ChannelProvider, request: ApprovalRequest): string {
    const requesterMention = this.#renderSubjectMention(provider, {
      kind: 'user',
      userId: request.requestedBy.userId,
    });
    const notifyMentions = this.renderSubjectMentions(provider, request.notifySubjects);
    const mentionText = notifyMentions.length ? `\n${notifyMentions.join(' ')}` : '';
    return [
      `Approval required for \`${request.action}\`.`,
      `Requester: ${requesterMention ?? request.requestedBy.userId}`,
      `Summary: ${request.summary}`,
      `Expires at: ${request.expiresAt}`,
      `Approval ID: ${request.id}`,
      mentionText,
    ]
      .filter(Boolean)
      .join('\n');
  }

  #renderSubjectMention(provider: ChannelProvider, subject: PermissionSubject): string | undefined {
    if (subject.kind === 'user') {
      if (subject.userId === '*') return undefined;
      if (provider === 'slack') return `<@${subject.userId}>`;
      if (provider === 'discord') return `<@${subject.userId}>`;
      return undefined;
    }
    if (subject.provider !== provider) {
      return undefined;
    }
    if (provider === 'slack') return `<!subteam^${subject.groupId}>`;
    if (provider === 'discord') return `<@&${subject.groupId}>`;
    return undefined;
  }

  #matchesContext(
    request: ApprovalRequest,
    input: Pick<AuthorizationInput, 'provider' | 'channelId' | 'threadId'>,
  ): boolean {
    if (request.provider !== input.provider) {
      return false;
    }
    if (request.context.channelId !== input.channelId) {
      return false;
    }
    if (request.context.threadId && request.context.threadId !== input.threadId) {
      return false;
    }
    return true;
  }

  async #evaluate(input: AuthorizationInput): Promise<PermissionDecision> {
    const candidateGroupIds = this.#candidateGroupIdsFor(input.provider, input.action);
    const preResolvedGroupIds = input.groupIds ?? [];
    const resolvedGroupIds =
      input.resolveGroups && candidateGroupIds.length
        ? await input.resolveGroups(candidateGroupIds)
        : [];
    const actor: PermissionActor = {
      provider: input.provider,
      userId: input.userId,
      groupIds: [...new Set([...preResolvedGroupIds, ...resolvedGroupIds])],
    };
    return evaluatePermissionDecision({
      config: this.#config.permissions,
      actor,
      context: {
        provider: input.provider,
        channelId: input.channelId,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.guildId ? { guildId: input.guildId } : {}),
      },
      action: input.action,
    });
  }

  #candidateGroupIdsFor(provider: ChannelProvider, action: PermissionAction): string[] {
    const groupIds = new Set<string>();
    for (const rule of this.#config.permissions.rules) {
      if (!rule.actions.includes(action)) continue;
      const subjects = [
        ...(rule.subjects ?? []),
        ...(rule.approverSubjects ?? []),
        ...(rule.notifySubjects ?? []),
      ];
      for (const subject of subjects) {
        if (subject.kind !== 'group') continue;
        if (subject.provider !== provider) continue;
        groupIds.add(subject.groupId);
      }
    }
    return [...groupIds];
  }
}
