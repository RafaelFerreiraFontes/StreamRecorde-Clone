CREATE TABLE "migration_manifests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"manifest_fingerprint" text NOT NULL,
	"source_digests" jsonb NOT NULL,
	"entity_counts" jsonb NOT NULL,
	"tool_version" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_manifests_manifest_fingerprint_unique" UNIQUE("manifest_fingerprint")
);