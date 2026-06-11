DROP TABLE "idempotency_keys";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "locked_by" varchar(255);