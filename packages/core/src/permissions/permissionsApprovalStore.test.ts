import { afterEach, describe, expect, it } from 'vitest';
import { closeJobRegistryDb, getJobRegistryDb } from '../db/index.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';
import { resetConfigCaches } from '../config/env.js';
import {
  approveIfPending,
  cancelIfPending,
  createApprovalRequest,
  denyIfPending,
  expireIfPending,
  loadApprovalRequest,
} from './permissionsApprovalStore.js';

describe('permissionsApprovalStore', () => {
  afterEach(async () => {
    await closeJobRegistryDb();
    resetConfigCaches();
  });

  async function ensureJobsTable() {
    const client = await getJobRegistryDb();
    if (client.kind === 'sqlite') {
      client.raw
        .prepare('CREATE TABLE IF NOT EXISTS jobs (job_id text PRIMARY KEY, record text NOT NULL)')
        .run();
      return;
    }
    await client.pool.query(
      'CREATE TABLE IF NOT EXISTS jobs (job_id text PRIMARY KEY, record jsonb NOT NULL)',
    );
  }

  it('creates and loads pending approvals', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureJobsTable();
    const request = await createApprovalRequest({
      base: {
        action: 'jobs.clearBefore',
        provider: 'slack',
        context: {
          provider: 'slack',
          channelId: 'C1',
        },
        requestedBy: { userId: 'U1' },
        approverSubjects: [{ kind: 'group', provider: 'slack', groupId: 'S1' }],
        notifySubjects: [{ kind: 'group', provider: 'slack', groupId: 'S1' }],
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
        summary: 'Clear before date',
      },
      ttlSeconds: 60,
    });

    const loaded = await loadApprovalRequest(request.id);
    expect(loaded?.status).toBe('pending');
    expect(loaded?.action).toBe('jobs.clearBefore');
  });

  it('updates request state only once', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureJobsTable();
    const request = await createApprovalRequest({
      base: {
        action: 'jobs.clear',
        provider: 'discord',
        context: {
          provider: 'discord',
          channelId: 'D1',
        },
        requestedBy: { userId: 'U_REQ' },
        approverSubjects: [{ kind: 'group', provider: 'discord', groupId: 'R1' }],
        notifySubjects: [{ kind: 'group', provider: 'discord', groupId: 'R1' }],
        operation: {
          kind: 'enqueueWorkerEvent',
          event: {
            schemaVersion: 1,
            type: 'jobs.clear',
            payload: {
              jobId: 'job-1',
              ttlMs: 60_000,
            },
          },
        },
        summary: 'Clear job',
      },
      ttlSeconds: 60,
    });

    const approved = await approveIfPending(request.id, 'U_APPROVER');
    expect(approved.changed).toBe(true);
    expect(approved.request?.status).toBe('approved');

    const denied = await denyIfPending(request.id, 'U_APPROVER_2');
    expect(denied.changed).toBe(false);
    expect(denied.reason).toBe('not_pending');
  });

  it('supports cancel and expire flows', async () => {
    applyRequiredEnv({ JOB_REGISTRY_DB: 'sqlite' });
    await ensureJobsTable();
    const request = await createApprovalRequest({
      base: {
        action: 'jobs.bootstrap',
        provider: 'slack',
        context: {
          provider: 'slack',
          channelId: 'C2',
        },
        requestedBy: { userId: 'U_REQ' },
        approverSubjects: [{ kind: 'user', userId: 'U_ADMIN' }],
        notifySubjects: [{ kind: 'user', userId: 'U_ADMIN' }],
        operation: {
          kind: 'enqueueBootstrap',
          request: {
            requestId: 'boot-1',
            repoName: 'repo',
            repoKey: 'repo',
            service: 'local',
            channel: {
              provider: 'slack',
              channelId: 'C2',
              userId: 'U_REQ',
            },
            localPath: '/tmp/repo',
          },
        },
        summary: 'Bootstrap repo',
      },
      ttlSeconds: 1,
    });

    const cancelled = await cancelIfPending(request.id, 'U_REQ');
    expect(cancelled.changed).toBe(true);
    expect(cancelled.request?.status).toBe('cancelled');

    const request2 = await createApprovalRequest({
      base: {
        action: 'jobs.bootstrap',
        provider: 'slack',
        context: {
          provider: 'slack',
          channelId: 'C2',
        },
        requestedBy: { userId: 'U_REQ' },
        approverSubjects: [{ kind: 'user', userId: 'U_ADMIN' }],
        notifySubjects: [{ kind: 'user', userId: 'U_ADMIN' }],
        operation: {
          kind: 'enqueueBootstrap',
          request: {
            requestId: 'boot-2',
            repoName: 'repo2',
            repoKey: 'repo2',
            service: 'local',
            channel: {
              provider: 'slack',
              channelId: 'C2',
              userId: 'U_REQ',
            },
            localPath: '/tmp/repo2',
          },
        },
        summary: 'Bootstrap repo2',
      },
      ttlSeconds: 1,
    });

    const expired = await expireIfPending(request2.id, new Date(Date.now() + 10_000));
    expect(expired.changed).toBe(true);
    expect(expired.request?.status).toBe('expired');
  });
});
