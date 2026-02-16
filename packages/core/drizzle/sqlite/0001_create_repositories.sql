CREATE TABLE IF NOT EXISTS repositories (
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

CREATE INDEX IF NOT EXISTS repositories_is_active_idx ON repositories (is_active);
