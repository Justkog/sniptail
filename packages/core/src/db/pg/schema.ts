import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { JOBS_TABLE } from '../shared/jobs.js';
import { REPOSITORIES_TABLE } from '../shared/repositories.js';

export const jobs = pgTable(JOBS_TABLE, {
  jobId: text('job_id').primaryKey(),
  record: jsonb('record').notNull(),
});

export const repoProviderEnum = pgEnum('repo_provider', ['github', 'gitlab', 'local']);

export const repositories = pgTable(REPOSITORIES_TABLE, {
  repoKey: text('repo_key').primaryKey(),
  provider: repoProviderEnum('provider').notNull(),
  sshUrl: text('ssh_url'),
  localPath: text('local_path'),
  projectId: integer('project_id'),
  baseBranch: text('base_branch').notNull().default('main'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
