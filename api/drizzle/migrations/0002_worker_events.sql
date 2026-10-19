CREATE TABLE "worker_events" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "fingerprint" text NOT NULL,
  "response_payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);