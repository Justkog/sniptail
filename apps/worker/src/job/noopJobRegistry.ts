import type { JobRecord } from '@sniptail/core/jobs/registry.js';
import type { ChannelProvider } from '@sniptail/core/types/channel.js';
import type { AgentId, JobType } from '@sniptail/core/types/job.js';
import type { JobRegistry } from './jobRegistry.js';

export class NoopJobRegistry implements JobRegistry {
  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async loadJobRecord(_jobId: string): Promise<JobRecord | undefined> {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async updateJobRecord(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _jobId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _patch: Partial<JobRecord>,
  ): Promise<JobRecord | undefined> {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async loadAllJobRecords(): Promise<JobRecord[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteJobRecords(_jobIds: string[]): Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async markJobForDeletion(_jobId: string, _ttlMs: number): Promise<JobRecord | undefined> {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async clearJobsBefore(_cutoff: Date): Promise<number> {
    return 0;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async findLatestJobByChannelThread(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _provider: ChannelProvider,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _channelId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _threadId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _agentId: AgentId,
  ): Promise<JobRecord | undefined> {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async findLatestJobByChannelThreadAndTypes(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _provider: ChannelProvider,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _channelId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _threadId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _types: JobType[],
  ): Promise<JobRecord | undefined> {
    return undefined;
  }
}
