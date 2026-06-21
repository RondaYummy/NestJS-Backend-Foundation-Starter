DROP INDEX "outbox_events_pending_lookup_idx";--> statement-breakpoint
DROP INDEX "outbox_events_processing_lock_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_lookup_idx" ON "outbox_events" USING btree ("available_at","attempts","created_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_processing_lock_idx" ON "outbox_events" USING btree ("locked_at") WHERE "outbox_events"."status" = 'processing';