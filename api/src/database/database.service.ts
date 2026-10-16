import { Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, PoolClient } from "pg";
import { join } from "path";
import * as schema from "./schema";

export type DatabaseConnection = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly database: DatabaseConnection;

  constructor(@Optional() databaseUrl?: string) {
    const resolvedUrl = databaseUrl ?? process.env.DATABASE_URL;
    this.pool = new Pool({ connectionString: resolvedUrl });
    this.database = drizzle(this.pool, { schema });
  }

  get connection(): DatabaseConnection {
    return this.database;
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
      .replace(/\b(host|hostaddr|port|database|dbname)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=***")
        .replace(/\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT)\s+[a-zA-Z0-9.-]+/g, "$1 [redacted-host]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[database-host]");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}