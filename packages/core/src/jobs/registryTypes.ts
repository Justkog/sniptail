import type { JobSpec, MergeRequestResult } from '../types/job.js';

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed';

export type JobRecord = {
  job: JobSpec;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  branchByRepo?: Record<string, string>;
  deleteAt?: string;
  summary?: string;
  mergeRequests?: MergeRequestResult[];
  error?: string;
  openQuestions?: string[];
};

export interface JobRegistryStore {
  kind: 'pg' | 'sqlite' | 'redis';
  loadAllRecordsByPrefix(prefix: string): Promise<JobRecord[]>;
  loadRecordByKey(key: string): Promise<JobRecord | undefined>;
  upsertRecord(key: string, record: JobRecord): Promise<void>;
  /**
   * Atomically updates the record at `key` only if the currently stored
   * record has `status` equal to `condition.statusEquals`.
   *
   * Returns `true` when the record was updated, `false` when the condition
   * was not satisfied or the record does not exist.
   */
  conditionalUpdateRecord(
    key: string,
    record: JobRecord,
    condition: { statusEquals: string },
  ): Promise<boolean>;
  deleteRecordsByKeys(keys: string[]): Promise<void>;
  deleteRecordByKey(key: string): Promise<void>;
}
