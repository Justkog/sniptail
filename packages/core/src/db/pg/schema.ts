import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { AGENT_SESSIONS_TABLE } from '../shared/agentSessions.js';
import { JOBS_TABLE } from '../shared/jobs.js';
import { REPOSITORIES_TABLE } from '../shared/repositories.js';
import { WORKER_AGENT_CAPABILITIES_TABLE } from '../shared/workerAgentCapabilities.js';

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

export const agentSessions = pgTable(
  AGENT_SESSIONS_TABLE,
  {
    sessionId: text('session_id').primaryKey(),
    provider: text('provider').notNull(),
    channelId: text('channel_id').notNull(),
    threadId: text('thread_id').notNull(),
    userId: text('user_id').notNull(),
    guildId: text('guild_id'),
    workspaceId: text('workspace_id'),
    workspaceKey: text('workspace_key').notNull(),
    agentProfileKey: text('agent_profile_key').notNull(),
    codingAgentSessionId: text('coding_agent_session_id'),
    cwd: text('cwd'),
    ownerWorkerId: text('owner_worker_id'),
    ownerWorkerLabel: text('owner_worker_label'),
    workerClaimedAt: timestamp('worker_claimed_at', { mode: 'string', withTimezone: true }),
    ownerStaleSince: timestamp('owner_stale_since', { mode: 'string', withTimezone: true }),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (table) => [
    index('agent_sessions_thread_idx').on(table.provider, table.threadId),
    index('agent_sessions_status_idx').on(table.status),
    index('agent_sessions_owner_worker_idx').on(table.ownerWorkerId),
    index('agent_sessions_owner_worker_status_idx').on(
      table.ownerWorkerId,
      table.status,
    ),
  ],
);

export const workerAgentCapabilities = pgTable(
  WORKER_AGENT_CAPABILITIES_TABLE,
  {
    workerId: text('worker_id').primaryKey(),
    workerLabel: text('worker_label'),
    enabled: boolean('enabled').notNull(),
    capabilityJson: jsonb('capability_json').notNull(),
    startedAt: timestamp('started_at', { mode: 'string', withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'string', withTimezone: true }).notNull(),
    activeRuntimeCount: integer('active_runtime_count'),
    maxActiveSessions: integer('max_active_sessions'),
  },
  (table) => [
    index('worker_agent_capabilities_last_seen_idx').on(table.lastSeenAt),
    index('worker_agent_capabilities_enabled_last_seen_idx').on(
      table.enabled,
      table.lastSeenAt,
    ),
  ],
);
