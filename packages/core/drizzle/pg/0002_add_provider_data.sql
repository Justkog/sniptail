-- Add provider_data column
ALTER TABLE "repositories" ADD COLUMN "provider_data" jsonb;

-- Change provider type from enum to text
ALTER TABLE "repositories"
  ALTER COLUMN "provider" TYPE text
  USING "provider"::text;

-- Drop the enum type after column conversion
DROP TYPE IF EXISTS "public"."repo_provider";
