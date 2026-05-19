CREATE INDEX IF NOT EXISTS jobs_thread_lookup_idx
  ON jobs (
    json_extract(record, '$.job.channel.provider'),
    json_extract(record, '$.job.channel.threadId'),
    json_extract(record, '$.job.channel.channelId'),
    json_extract(record, '$.job.type'),
    json_extract(record, '$.createdAt')
  )
  WHERE job_id LIKE 'job:%';

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS jobs_cleanup_idx
  ON jobs (
    json_extract(record, '$.job.type'),
    json_extract(record, '$.createdAt')
  )
  WHERE job_id LIKE 'job:%';
