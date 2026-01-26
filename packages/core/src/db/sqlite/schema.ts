import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { JOBS_TABLE } from '../shared/jobs.js';

export const jobs = sqliteTable(JOBS_TABLE, {
  jobId: text('job_id').primaryKey(),
  record: text('record').notNull(),
});
