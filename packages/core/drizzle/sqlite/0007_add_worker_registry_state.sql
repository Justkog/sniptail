ALTER TABLE agent_sessions ADD COLUMN owner_worker_id text;

--> statement-breakpoint

ALTER TABLE agent_sessions ADD COLUMN owner_worker_label text;

--> statement-breakpoint

ALTER TABLE agent_sessions ADD COLUMN worker_claimed_at text;

--> statement-breakpoint

ALTER TABLE agent_sessions ADD COLUMN owner_stale_since text;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS agent_sessions_owner_worker_idx ON agent_sessions (owner_worker_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS agent_sessions_owner_worker_status_idx ON agent_sessions (owner_worker_id, status);

--> statement-breakpoint

CREATE TABLE worker_agent_capabilities (
  worker_id text PRIMARY KEY,
  worker_label text,
  enabled integer NOT NULL,
  capability_json text NOT NULL,
  started_at text NOT NULL,
  last_seen_at text NOT NULL,
  active_runtime_count integer,
  max_active_sessions integer
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS worker_agent_capabilities_last_seen_idx ON worker_agent_capabilities (last_seen_at);
