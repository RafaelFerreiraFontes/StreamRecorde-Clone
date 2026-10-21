CREATE TABLE users (
  id uuid PRIMARY KEY,
  bootstrap_key text UNIQUE,
  username text NOT NULL UNIQUE,
  email text,
  password_hash text,
  disabled_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  CONSTRAINT users_email_lowercase_check CHECK (email IS NULL OR email = lower(email))
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_idle_expires_at ON sessions (idle_expires_at);
--> statement-breakpoint
INSERT INTO users (id, bootstrap_key, username, password_hash, created_at, updated_at)
VALUES (gen_random_uuid(), 'local', 'local', NULL, NOW(), NOW())
ON CONFLICT (bootstrap_key) DO NOTHING;
--> statement-breakpoint
ALTER TABLE creators ADD COLUMN owner_id uuid;
ALTER TABLE watch_targets ADD COLUMN owner_id uuid;
ALTER TABLE streams ADD COLUMN owner_id uuid;
ALTER TABLE recordings ADD COLUMN owner_id uuid;
ALTER TABLE migration_manifests ADD COLUMN owner_id uuid;
--> statement-breakpoint
UPDATE creators SET owner_id = (SELECT id FROM users WHERE bootstrap_key = 'local') WHERE owner_id IS NULL;
UPDATE watch_targets SET owner_id = (SELECT id FROM users WHERE bootstrap_key = 'local') WHERE owner_id IS NULL;
UPDATE streams SET owner_id = (SELECT id FROM users WHERE bootstrap_key = 'local') WHERE owner_id IS NULL;
UPDATE recordings SET owner_id = (SELECT id FROM users WHERE bootstrap_key = 'local') WHERE owner_id IS NULL;
UPDATE migration_manifests SET owner_id = (SELECT id FROM users WHERE bootstrap_key = 'local') WHERE owner_id IS NULL;
--> statement-breakpoint
ALTER TABLE creators ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE watch_targets ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE streams ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE recordings ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE migration_manifests ALTER COLUMN owner_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE creators ADD CONSTRAINT creators_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE creators ADD CONSTRAINT creators_id_owner_id_unique UNIQUE (id, owner_id);
ALTER TABLE watch_targets ADD CONSTRAINT watch_targets_id_owner_id_unique UNIQUE (id, owner_id);
ALTER TABLE watch_targets ADD CONSTRAINT watch_targets_creator_owner_fk FOREIGN KEY (creator_id, owner_id) REFERENCES creators(id, owner_id) ON DELETE RESTRICT;
ALTER TABLE streams ADD CONSTRAINT streams_watch_target_owner_fk FOREIGN KEY (watch_target_id, owner_id) REFERENCES watch_targets(id, owner_id) ON DELETE RESTRICT;
ALTER TABLE recordings ADD CONSTRAINT recordings_watch_target_owner_fk FOREIGN KEY (watch_target_id, owner_id) REFERENCES watch_targets(id, owner_id) ON DELETE RESTRICT;
ALTER TABLE migration_manifests ADD CONSTRAINT migration_manifests_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX idx_creators_owner_normalized_key ON creators (owner_id, normalized_key);
CREATE INDEX idx_watch_targets_owner_id ON watch_targets (owner_id, id);
CREATE INDEX idx_watch_targets_creator_owner ON watch_targets (creator_id, owner_id);
CREATE INDEX idx_streams_owner_watch_target ON streams (owner_id, watch_target_id);
CREATE INDEX idx_recordings_owner_watch_target ON recordings (owner_id, watch_target_id);
CREATE INDEX idx_migration_manifests_owner_fingerprint ON migration_manifests (owner_id, manifest_fingerprint);