CREATE INDEX IF NOT EXISTS "jobs_thread_lookup_idx"
  ON "jobs" (
    (record #>> '{job,channel,provider}'),
    (record #>> '{job,channel,threadId}'),
    (record #>> '{job,channel,channelId}'),
    (record #>> '{job,type}'),
    (record ->> 'createdAt')
  )
  WHERE job_id LIKE 'job:%';

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jobs_cleanup_idx"
  ON "jobs" (
    (record #>> '{job,type}'),
    (record ->> 'createdAt')
  )
  WHERE job_id LIKE 'job:%';
