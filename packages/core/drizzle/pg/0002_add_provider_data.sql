-- Add provider_data column
ALTER TABLE "repositories" ADD COLUMN "provider_data" jsonb;

-- Change provider type from enum to text
-- First, alter the column to text
ALTER TABLE "repositories" ALTER COLUMN "provider" TYPE text;

-- Drop the enum type (it may still be in use, so we do this after altering the column)
-- Note: This will fail if other tables use this enum, but in this case only repositories uses it
DROP TYPE IF EXISTS "public"."repo_provider";
