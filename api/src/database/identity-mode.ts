import { Pool } from "pg";
import { parseTrustedOrigins } from "../auth/origin-policy";

export interface StartupValidationOptions {
  pool?: Pool;
  queryRunner?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export function resolveIdentityMode(env: NodeJS.ProcessEnv): "local" | "authenticated" {
  const mode = env.IDENTITY_MODE;
  if (mode === undefined || mode === "" || mode === "local") return "local";
  if (mode === "authenticated") return "authenticated";
  throw new Error(`Invalid IDENTITY_MODE "${mode}": expected "local" or "authenticated"`);
}

export async function validateStartupIdentityMode(
  env: NodeJS.ProcessEnv,
  options: StartupValidationOptions = {},
): Promise<"local" | "authenticated"> {
  if (resolveIdentityMode(env) === "local") return "local";
  if (env.RELATIONAL_STORAGE !== "true") {
    throw new Error("Authenticated mode requires RELATIONAL_STORAGE=true");
  }
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new Error("Authenticated mode requires a valid PostgreSQL DATABASE_URL");
  }
  if (parseTrustedOrigins(env.AUTH_TRUSTED_ORIGINS).size === 0) {
    throw new Error("Authenticated mode requires non-empty AUTH_TRUSTED_ORIGINS");
  }

  const pool =
    options.pool ??
    (options.queryRunner
      ? undefined
      : new Pool({
          connectionString: env.DATABASE_URL,
          connectionTimeoutMillis: 5000,
        }));
  const query =
    options.queryRunner ?? ((sql: string, params?: unknown[]) => pool!.query(sql, params));
  try {
    try {
      await query("SELECT 1");
    } catch {
      // Driver errors may contain connection strings or credentials; never echo them.
      throw new Error("Database connection failed: PostgreSQL is unreachable or access was denied");
    }
    const schema = await query(`
      SELECT 1 WHERE NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('users', 'id'), ('users', 'username'), ('users', 'password_hash'),
          ('users', 'disabled_at'), ('sessions', 'user_id'), ('sessions', 'token_hash'),
          ('creators', 'owner_id'), ('watch_targets', 'owner_id'),
          ('streams', 'owner_id'), ('recordings', 'owner_id')
        ) AS required(table_name, column_name)
        WHERE NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = current_schema()
            AND c.table_name = required.table_name AND c.column_name = required.column_name
        )
      ) AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('watch_targets_creator_owner_fk'), ('streams_watch_target_owner_fk'),
          ('recordings_watch_target_owner_fk'), ('recordings_stream_watch_target_fk')
        ) AS required(name)
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = current_schema() AND c.conname = required.name
            AND c.contype = 'f' AND cardinality(c.conkey) > 1 AND c.convalidated
        )
      )
    `);
    if (schema.rows.length === 0) {
      throw new Error(
        "Database schema missing required Wave 05.5 tables, ownership columns, or composite constraints",
      );
    }
    const users = await query(
      "SELECT 1 FROM users WHERE disabled_at IS NULL AND password_hash IS NOT NULL LIMIT 1;",
    );
    if (users.rows.length === 0) {
      throw new Error(
        "Authenticated mode requires at least one enabled user with an enrolled password",
      );
    }
    return "authenticated";
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Database connection failed:|Database schema missing required|Authenticated mode requires)/.test(
        error.message,
      )
    )
      throw error;
    throw new Error("Database startup prerequisite check failed");
  } finally {
    if (pool) {
      await pool.end().catch(() => {
        throw new Error("Database startup connection cleanup failed");
      });
    }
  }
}
