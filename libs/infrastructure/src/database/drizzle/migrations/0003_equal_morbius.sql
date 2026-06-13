CREATE INDEX IF NOT EXISTS
  "outbox_events_pending_lookup_idx"
ON "outbox_events" (
  "available_at",
  "attempts",
  "created_at"
)
WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS
  "outbox_events_processing_lock_idx"
ON "outbox_events" (
  "locked_at"
)
WHERE "status" = 'processing';