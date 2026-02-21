import type { BootstrapRequest } from '../types/bootstrap.js';
import type { ChannelProvider } from '../types/channel.js';
import type { JobSpec } from '../types/job.js';
import type { WorkerEvent } from '../types/worker-event.js';
import type { PermissionAction } from './permissionsActionCatalog.js';
import type { PermissionSubject } from './permissionsPolicyTypes.js';

export type DeferredPermissionOperation =
  | {
      kind: 'enqueueJob';
      job: JobSpec;
    }
  | {
      kind: 'enqueueBootstrap';
      request: BootstrapRequest;
    }
  | {
      kind: 'enqueueWorkerEvent';
      event: WorkerEvent;
    };

export type ApprovalResolution = 'approved' | 'denied' | 'cancelled' | 'expired';
export type ApprovalRequestStatus = 'pending' | ApprovalResolution;

export type ApprovalRequestContext = {
  provider: ChannelProvider;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  guildId?: string;
};

export type ApprovalRequest = {
  id: string;
  status: ApprovalRequestStatus;
  action: PermissionAction;
  provider: ChannelProvider;
  context: ApprovalRequestContext;
  requestedBy: {
    userId: string;
  };
  approverSubjects: PermissionSubject[];
  notifySubjects: PermissionSubject[];
  operation: DeferredPermissionOperation;
  summary: string;
  createdAt: string;
  expiresAt: string;
  resolvedBy?: {
    userId: string;
  };
  resolvedAt?: string;
  resolution?: ApprovalResolution;
  ruleId?: string;
};

export type ApprovalTransitionResult = {
  request?: ApprovalRequest;
  changed: boolean;
  reason: 'not_found' | 'not_pending' | 'expired' | 'updated';
};
