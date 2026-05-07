CREATE TABLE agent_sessions (
  session_id text PRIMARY KEY,
  provider text NOT NULL,
  channel_id text NOT NULL,
  thread_id text NOT NULL,
  user_id text NOT NULL,
  guild_id text,
  workspace_key text NOT NULL,
  agent_profile_key text NOT NULL,
  cwd text,
  status text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS agent_sessions_thread_idx ON agent_sessions (provider, thread_id);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS agent_sessions_status_idx ON agent_sessions (status);
