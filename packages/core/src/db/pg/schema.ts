import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { JOBS_TABLE } from '../shared/jobs.js';

export const jobs = pgTable(JOBS_TABLE, {
  jobId: text('job_id').primaryKey(),
  record: jsonb('record').notNull(),
});
