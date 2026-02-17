import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { JOBS_TABLE } from '../shared/jobs.js';
import { REPOSITORIES_TABLE } from '../shared/repositories.js';

export const jobs = pgTable(JOBS_TABLE, {
  jobId: text('job_id').primaryKey(),
  record: jsonb('record').notNull(),
});

export const repositories = pgTable(REPOSITORIES_TABLE, {
  repoKey: text('repo_key').primaryKey(),
  provider: text('provider').notNull(),
  sshUrl: text('ssh_url'),
  localPath: text('local_path'),
  projectId: integer('project_id'),
  providerData: jsonb('provider_data'),
  baseBranch: text('base_branch').notNull().default('main'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
