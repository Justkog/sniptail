CREATE TABLE IF NOT EXISTS "repositories" (
  "repo_key" text PRIMARY KEY,
  "provider" text NOT NULL,
  "ssh_url" text,
  "local_path" text,
  "project_id" integer,
  "provider_data" jsonb,
  "base_branch" text NOT NULL DEFAULT 'main',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT repositories_location_chk CHECK (
    ("ssh_url" IS NOT NULL AND "local_path" IS NULL)
    OR
    ("ssh_url" IS NULL AND "local_path" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "repositories_is_active_idx" ON "repositories" ("is_active");
