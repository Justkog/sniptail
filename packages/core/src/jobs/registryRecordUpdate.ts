import type { JobRecord, JobRecordPatch } from './registryTypes.js';

const MAX_UPDATE_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = 25;

export function applyJobRecordPatch(
  record: JobRecord,
  patch: JobRecordPatch,
  updatedAt: string,
): JobRecord {
  return {
    ...record,
    ...patch,
    job: typeof patch.job === 'function' ? patch.job(record.job) : (patch.job ?? record.job),
    updatedAt,
  };
}

export async function updateStoredJobRecord(
  read: () => Promise<string | undefined>,
  compareAndSwap: (previous: string, next: string) => Promise<boolean>,
  update: (record: JobRecord) => JobRecord,
): Promise<JobRecord | undefined> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const previous = await read();
    if (previous === undefined) return undefined;
    const updated = update(JSON.parse(previous) as JobRecord);
    if (await compareAndSwap(previous, JSON.stringify(updated))) return updated;
    if (attempt < MAX_UPDATE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }
  }
  throw new Error(
    `Failed to update stored job record after ${MAX_UPDATE_ATTEMPTS} attempts due to contention`,
  );
}
