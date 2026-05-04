import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { JOBS_TABLE } from '../shared/jobs.js';
import { REPOSITORIES_TABLE } from '../shared/repositories.js';
import { AGENT_SESSIONS_TABLE } from '../shared/agentSessions.js';
import { AGENT_DEFAULTS_TABLE } from '../shared/agentDefaults.js';

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

export const agentSessions = sqliteTable(AGENT_SESSIONS_TABLE, {
  sessionId: text('session_id').primaryKey(),
  provider: text('provider').notNull(),
  channelId: text('channel_id').notNull(),
  threadId: text('thread_id').notNull(),
  userId: text('user_id').notNull(),
  guildId: text('guild_id'),
  workspaceKey: text('workspace_key').notNull(),
  agentProfileKey: text('agent_profile_key').notNull(),
  codingAgentSessionId: text('coding_agent_session_id'),
  cwd: text('cwd'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentDefaults = sqliteTable(AGENT_DEFAULTS_TABLE, {
  scopeKey: text('scope_key').primaryKey(),
  provider: text('provider').notNull(),
  userId: text('user_id').notNull(),
  guildId: text('guild_id'),
  workspaceKey: text('workspace_key').notNull(),
  agentProfileKey: text('agent_profile_key').notNull(),
  cwd: text('cwd'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
