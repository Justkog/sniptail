import type { JobRecord, JobRecordPatch } from './registryTypes.js';

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
  for (;;) {
    const previous = await read();
    if (previous === undefined) return undefined;
    const updated = update(JSON.parse(previous) as JobRecord);
    if (await compareAndSwap(previous, JSON.stringify(updated))) return updated;
  }
}
