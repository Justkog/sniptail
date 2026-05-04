CREATE TABLE agent_defaults (
  scope_key text PRIMARY KEY,
  provider text NOT NULL,
  user_id text NOT NULL,
  guild_id text,
  workspace_key text NOT NULL,
  agent_profile_key text NOT NULL,
  cwd text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
