CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "session_id" text PRIMARY KEY,
  "provider" text NOT NULL,
  "channel_id" text NOT NULL,
  "thread_id" text NOT NULL,
  "user_id" text NOT NULL,
  "guild_id" text,
  "workspace_id" text,
  "workspace_key" text NOT NULL,
  "agent_profile_key" text NOT NULL,
  "coding_agent_session_id" text,
  "cwd" text,
  "owner_worker_id" text,
  "owner_worker_label" text,
  "worker_claimed_at" timestamptz,
  "owner_stale_since" timestamptz,
  "status" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_sessions_thread_idx"
  ON "agent_sessions" ("provider", "thread_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_sessions_status_idx"
  ON "agent_sessions" ("status");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_sessions_owner_worker_idx"
  ON "agent_sessions" ("owner_worker_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_sessions_owner_worker_status_idx"
  ON "agent_sessions" ("owner_worker_id", "status");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "worker_agent_capabilities" (
  "worker_id" text PRIMARY KEY,
  "worker_label" text,
  "enabled" boolean NOT NULL,
  "capability_json" jsonb NOT NULL,
  "started_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "active_runtime_count" integer,
  "max_active_sessions" integer
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "worker_agent_capabilities_last_seen_idx"
  ON "worker_agent_capabilities" ("last_seen_at");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "worker_agent_capabilities_enabled_last_seen_idx"
  ON "worker_agent_capabilities" ("enabled", "last_seen_at");
