import type { JobRecord } from '@sniptail/core/jobs/registryTypes.js';
import { loadJobRecord, updateJobRecord } from '@sniptail/core/jobs/registry.js';
import { loadAggregatedAgentCapabilitySnapshot } from '@sniptail/core/registry/registryCapabilities.js';

export type ManagedJobOwnerRoute =
  | {
      ok: true;
      sourceJob: JobRecord;
      targetWorkerId: string;
    }
  | {
      ok: false;
      errorMessage: string;
      sourceJob?: JobRecord;
    };

function formatOwnerWorker(record: JobRecord): string {
  if (!record.ownerWorkerId) {
    return 'unknown';
  }
  return record.ownerWorkerLabel
    ? `${record.ownerWorkerLabel} (${record.ownerWorkerId})`
    : record.ownerWorkerId;
}

function buildMissingSourceMessage(jobId: string): string {
  return `Job ${jobId} was not found, so it cannot be resumed.`;
}

function buildMissingOwnerMessage(jobId: string): string {
  return `Job ${jobId} has no owner worker and cannot be resumed safely.`;
}

function buildStaleOwnerMessage(jobId: string, record: JobRecord): string {
  return `Job ${jobId} is waiting for owner worker ${formatOwnerWorker(record)} to return.`;
}

function buildJobOwnershipPatch(input: {
  ownerWorkerId: string;
  ownerWorkerLabel?: string;
  workerClaimedAt?: string;
  clearOwnerStaleSince?: boolean;
  ownerStaleSince?: string;
}): Partial<JobRecord> {
  const patch: Partial<JobRecord> = {
    ownerWorkerId: input.ownerWorkerId,
    ...(input.ownerWorkerLabel ? { ownerWorkerLabel: input.ownerWorkerLabel } : {}),
    ...(input.workerClaimedAt ? { workerClaimedAt: input.workerClaimedAt } : {}),
    ...(input.ownerStaleSince ? { ownerStaleSince: input.ownerStaleSince } : {}),
  };
  if (input.clearOwnerStaleSince) {
    return {
      ...patch,
      ownerStaleSince: undefined,
    } as unknown as Partial<JobRecord>;
  }
  return patch;
}

export async function resolveManagedJobOwnerRoute(input: {
  resumeFromJobId: string;
}): Promise<ManagedJobOwnerRoute> {
  const sourceJob = await loadJobRecord(input.resumeFromJobId);
  if (!sourceJob) {
    return {
      ok: false,
      errorMessage: buildMissingSourceMessage(input.resumeFromJobId),
    };
  }

  if (!sourceJob.ownerWorkerId) {
    return {
      ok: false,
      sourceJob,
      errorMessage: buildMissingOwnerMessage(input.resumeFromJobId),
    };
  }

  const snapshot = await loadAggregatedAgentCapabilitySnapshot();
  const liveOwner = snapshot.aggregated.liveWorkers.find(
    (worker) => worker.workerId === sourceJob.ownerWorkerId,
  );

  if (!liveOwner) {
    if (!sourceJob.ownerStaleSince) {
      const ownerStaleSince = new Date().toISOString();
      const updated = await updateJobRecord(
        input.resumeFromJobId,
        buildJobOwnershipPatch({
          ownerWorkerId: sourceJob.ownerWorkerId,
          ...(sourceJob.ownerWorkerLabel
            ? { ownerWorkerLabel: sourceJob.ownerWorkerLabel }
            : {}),
          ...(sourceJob.workerClaimedAt ? { workerClaimedAt: sourceJob.workerClaimedAt } : {}),
          ownerStaleSince,
        }),
      );
      return {
        ok: false,
        sourceJob: updated,
        errorMessage: buildStaleOwnerMessage(input.resumeFromJobId, updated),
      };
    }

    return {
      ok: false,
      sourceJob,
      errorMessage: buildStaleOwnerMessage(input.resumeFromJobId, sourceJob),
    };
  }

  if (sourceJob.ownerStaleSince || sourceJob.ownerWorkerLabel !== liveOwner.workerLabel) {
    const updated = await updateJobRecord(
      input.resumeFromJobId,
      buildJobOwnershipPatch({
        ownerWorkerId: sourceJob.ownerWorkerId,
        ...(liveOwner.workerLabel ? { ownerWorkerLabel: liveOwner.workerLabel } : {}),
        ...(sourceJob.workerClaimedAt ? { workerClaimedAt: sourceJob.workerClaimedAt } : {}),
        clearOwnerStaleSince: true,
      }),
    );
    return {
      ok: true,
      sourceJob: updated,
      targetWorkerId: sourceJob.ownerWorkerId,
    };
  }

  return {
    ok: true,
    sourceJob,
    targetWorkerId: sourceJob.ownerWorkerId,
  };
}
