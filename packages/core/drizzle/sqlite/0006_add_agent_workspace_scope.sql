ALTER TABLE agent_sessions ADD COLUMN workspace_id text;

--> statement-breakpoint

ALTER TABLE agent_defaults ADD COLUMN workspace_id text;
