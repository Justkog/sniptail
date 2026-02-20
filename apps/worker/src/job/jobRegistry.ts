import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { ChannelProvider } from '@sniptail/core/types/channel.js';
import type { AgentId, JobType } from '@sniptail/core/types/job.js';

export type JobRegistrySnapshot = {
  records: JobRecord[];
};

export interface JobRegistry {
  loadJobRecord(jobId: string): Promise<JobRecord | undefined>;
  updateJobRecord(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined>;
  loadAllJobRecords(): Promise<JobRecord[]>;
  deleteJobRecords(jobIds: string[]): Promise<void>;
  markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord | undefined>;
  clearJobsBefore(cutoff: Date): Promise<number>;
  findLatestJobByChannelThread(
    provider: ChannelProvider,
    channelId: string,
    threadId: string,
    agentId: AgentId,
  ): Promise<JobRecord | undefined>;
  findLatestJobByChannelThreadAndTypes(
    provider: ChannelProvider,
    channelId: string,
    threadId: string,
    types: JobType[],
  ): Promise<JobRecord | undefined>;
}

export interface SnapshottingJobRegistry extends JobRegistry {
  snapshot(): JobRegistrySnapshot;
}
