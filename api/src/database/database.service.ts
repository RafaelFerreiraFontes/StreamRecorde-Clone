import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, PoolClient } from "pg";
import { join } from "path";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type DatabaseConnection = NodePgDatabase<typeof schema>;

export async function resolveBootstrapLocalUser(
  client: Pick<DatabaseConnection, "execute">,
): Promise<string> {
  const inserted = await client.execute<{ id: string }>(sql`INSERT INTO users
    (id, bootstrap_key, username, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'local', 'local', NULL, NOW(), NOW())
    ON CONFLICT (bootstrap_key) DO NOTHING RETURNING id`);
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await client.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE bootstrap_key = 'local'`,
  );
  if (!existing.rows[0]) throw new Error("Bootstrap local user is unavailable");
  return existing.rows[0].id;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  private readonly database: DatabaseConnection;

  constructor(@Optional() databaseUrl?: string) {
    const resolvedUrl = databaseUrl ?? process.env.DATABASE_URL;
    this.pool = new Pool({ connectionString: resolvedUrl, connectionTimeoutMillis: 5000 });
    this.pool.on("error", () => {
      this.logger.warn("Database idle connection lost; subsequent operations will reconnect");
    });
    this.database = drizzle(this.pool, { schema });
  }

  get connection(): DatabaseConnection {
    return this.database;
  }

  async resolveBootstrapLocalUser(
    client?: PoolClient | Pick<DatabaseConnection, "execute">,
  ): Promise<string> {
    return resolveBootstrapLocalUser(
      client && "release" in client ? drizzle(client, { schema }) : (client ?? this.database),
    );
  }

  async ping(): Promise<void> {
    try {
      await this.pool.query("select 1");
    } catch (error) {
      throw new Error(`Database connection failed: ${this.sanitizeError(error)}`);
    }
  }

  async transaction<T>(runner: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("begin");
      const result = await runner(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client?.query("rollback").catch(() => undefined);
      throw new Error(`Database transaction failed: ${this.sanitizeError(error)}`);
    } finally {
      client?.release();
    }
  }

  async migrate(): Promise<void> {
    try {
      await migrate(this.database, {
        migrationsFolder: join(__dirname, "../../drizzle/migrations"),
      });
    } catch (error) {
      throw new Error(`Database migration failed: ${this.sanitizeError(error)}`);
    }
  }

  sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : "unknown database error";
    return message
      .replace(/\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://***")
      .replace(/\b(password|pass|pwd)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=***")
      .replace(
        /\b(host|hostaddr|port|database|dbname)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1=***",
      )
      .replace(/\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT)\s+[a-zA-Z0-9.-]+/g, "$1 [redacted-host]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[database-host]");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
