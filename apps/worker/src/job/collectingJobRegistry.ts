import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { ChannelProvider } from '@sniptail/core/types/channel.js';
import type { AgentId, JobSpec, JobType } from '@sniptail/core/types/job.js';
import type { JobRegistrySnapshot, SnapshottingJobRegistry } from './jobRegistry.js';

type CollectingJobRegistryOptions = {
  seedJob?: JobSpec;
  now?: () => Date;
};

export class CollectingJobRegistry implements SnapshottingJobRegistry {
  private readonly records = new Map<string, JobRecord>();
  private readonly now: () => Date;

  constructor(options: CollectingJobRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    if (options.seedJob) {
      this.saveJobQueued(options.seedJob);
    }
  }

  seedJob(job: JobSpec): JobRecord {
    return this.saveJobQueued(job);
  }

  snapshot(): JobRegistrySnapshot {
    return { records: Array.from(this.records.values()) };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
    return this.records.get(jobId);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async updateJobRecord(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    const existing = this.records.get(jobId);
    if (!existing) {
      throw new Error(`Job record not found for ${jobId}`);
    }
    const updated: JobRecord = {
      ...existing,
      ...patch,
      job: patch.job ?? existing.job,
      updatedAt: this.now().toISOString(),
    };
    this.records.set(jobId, updated);
    return updated;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async loadAllJobRecords(): Promise<JobRecord[]> {
    return Array.from(this.records.values());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteJobRecords(jobIds: string[]): Promise<void> {
    for (const jobId of jobIds) {
      this.records.delete(jobId);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord | undefined> {
    const existing = this.records.get(jobId);
    if (!existing) {
      throw new Error(`Job record not found for ${jobId}`);
    }
    const now = this.now();
    const deleteAt = new Date(now.getTime() + ttlMs).toISOString();
    const updated: JobRecord = {
      ...existing,
      deleteAt,
      updatedAt: now.toISOString(),
    };
    this.records.set(jobId, updated);
    setTimeout(() => {
      this.records.delete(jobId);
    }, ttlMs);
    return updated;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clearJobsBefore(cutoff: Date): Promise<number> {
    const cutoffTime = cutoff.getTime();
    if (Number.isNaN(cutoffTime)) {
      throw new Error('Invalid cutoff date.');
    }
    let removed = 0;
    for (const [jobId, record] of this.records.entries()) {
      const createdTime = Date.parse(record.createdAt);
      if (Number.isNaN(createdTime)) continue;
      if (createdTime < cutoffTime) {
        this.records.delete(jobId);
        removed += 1;
      }
    }
    return removed;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async findLatestJobByChannelThread(
    provider: ChannelProvider,
    channelId: string,
    threadId: string,
    agentId: AgentId,
  ): Promise<JobRecord | undefined> {
    let latestWithThreadId: JobRecord | undefined;
    let latestTime = -1;

    for (const record of this.records.values()) {
      const channel = record?.job?.channel;
      if (!channel || channel.provider !== provider) continue;
      if (channel.channelId !== channelId || channel.threadId !== threadId) continue;
      const agentThreadId = record.job?.agentThreadIds?.[agentId];
      if (!agentThreadId) continue;
      const createdTime = Date.parse(record.createdAt);
      if (Number.isNaN(createdTime)) continue;
      if (createdTime > latestTime) {
        latestWithThreadId = record;
        latestTime = createdTime;
      }
    }

    return latestWithThreadId;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async findLatestJobByChannelThreadAndTypes(
    provider: ChannelProvider,
    channelId: string,
    threadId: string,
    types: JobType[],
  ): Promise<JobRecord | undefined> {
    let latest: JobRecord | undefined;
    let latestTime = -1;

    for (const record of this.records.values()) {
      const channel = record?.job?.channel;
      if (!channel || channel.provider !== provider) continue;
      if (channel.channelId !== channelId || channel.threadId !== threadId) continue;
      if (!types.includes(record.job.type)) continue;
      const createdTime = Date.parse(record.createdAt);
      if (Number.isNaN(createdTime)) continue;
      if (createdTime > latestTime) {
        latest = record;
        latestTime = createdTime;
      }
    }

    return latest;
  }

  private saveJobQueued(job: JobSpec): JobRecord {
    const now = this.now().toISOString();
    const record: JobRecord = {
      job,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(job.jobId, record);
    return record;
  }
}
