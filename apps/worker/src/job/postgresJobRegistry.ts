import {
  clearJobsBefore as clearJobsBeforeDb,
  deleteJobRecords as deleteJobRecordsDb,
  findLatestJobByChannelThread as findLatestJobByChannelThreadDb,
  findLatestJobByChannelThreadAndTypes as findLatestJobByChannelThreadAndTypesDb,
  loadAllJobRecords as loadAllJobRecordsDb,
  loadJobRecord as loadJobRecordDb,
  markJobForDeletion as markJobForDeletionDb,
  updateJobRecord as updateJobRecordDb,
} from '@sniptail/core/jobs/registry.js';
import type { AgentId, JobType } from '@sniptail/core/types/job.js';
import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { JobRegistry } from './jobRegistry.js';

export class PostgresJobRegistry implements JobRegistry {
  async loadJobRecord(jobId: string): Promise<JobRecord | undefined> {
    return loadJobRecordDb(jobId);
  }

  async updateJobRecord(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    return updateJobRecordDb(jobId, patch);
  }

  async loadAllJobRecords(): Promise<JobRecord[]> {
    return loadAllJobRecordsDb();
  }

  async deleteJobRecords(jobIds: string[]): Promise<void> {
    await deleteJobRecordsDb(jobIds);
  }

  async markJobForDeletion(jobId: string, ttlMs: number): Promise<JobRecord | undefined> {
    return markJobForDeletionDb(jobId, ttlMs);
  }

  async clearJobsBefore(cutoff: Date): Promise<number> {
    return clearJobsBeforeDb(cutoff);
  }

  async findLatestJobByChannelThread(
    provider: 'slack' | 'discord',
    channelId: string,
    threadId: string,
    agentId: AgentId,
  ): Promise<JobRecord | undefined> {
    return findLatestJobByChannelThreadDb(provider, channelId, threadId, agentId);
  }

  async findLatestJobByChannelThreadAndTypes(
    provider: 'slack' | 'discord',
    channelId: string,
    threadId: string,
    types: JobType[],
  ): Promise<JobRecord | undefined> {
    return findLatestJobByChannelThreadAndTypesDb(provider, channelId, threadId, types);
  }
}
