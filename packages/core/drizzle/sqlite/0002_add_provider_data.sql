-- Add provider_data column
ALTER TABLE repositories ADD COLUMN provider_data text;

--> statement-breakpoint

-- SQLite doesn't support dropping CHECK constraints directly,
-- so we keep the provider field as text but remove the CHECK constraint
-- by recreating the table without the enum constraint
CREATE TABLE repositories_new (
  repo_key text PRIMARY KEY,
  provider text NOT NULL,
  ssh_url text,
  local_path text,
  project_id integer,
  provider_data text,
  base_branch text NOT NULL DEFAULT 'main',
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (
    (ssh_url IS NOT NULL AND local_path IS NULL)
    OR
    (ssh_url IS NULL AND local_path IS NOT NULL)
  )
);

--> statement-breakpoint

-- Copy data from old table to new table
INSERT INTO repositories_new SELECT 
  repo_key,
  provider,
  ssh_url,
  local_path,
  project_id,
  provider_data,
  base_branch,
  is_active,
  created_at,
  updated_at
FROM repositories;

--> statement-breakpoint

-- Drop old table and rename new table
DROP TABLE repositories;

--> statement-breakpoint

ALTER TABLE repositories_new RENAME TO repositories;

--> statement-breakpoint

-- Recreate index
CREATE INDEX IF NOT EXISTS repositories_is_active_idx ON repositories (is_active);
