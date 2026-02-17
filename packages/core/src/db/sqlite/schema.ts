import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { JOBS_TABLE } from '../shared/jobs.js';
import { REPOSITORIES_TABLE } from '../shared/repositories.js';

export const jobs = sqliteTable(JOBS_TABLE, {
  jobId: text('job_id').primaryKey(),
  record: text('record').notNull(),
});

export const repositories = sqliteTable(REPOSITORIES_TABLE, {
  repoKey: text('repo_key').primaryKey(),
  provider: text('provider').notNull(),
  sshUrl: text('ssh_url'),
  localPath: text('local_path'),
  projectId: integer('project_id'),
  providerData: text('provider_data'),
  baseBranch: text('base_branch').notNull().default('main'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
