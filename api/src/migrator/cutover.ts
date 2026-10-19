import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseService } from "../database/database.service";
import { FILES, inspectSnapshot, digest, canonical } from "./snapshot";

export async function cutoverCheck(database: DatabaseService, source: string, apiUrl: string, observationMs: number, outboxDir?: string) {
  if (process.env.RELATIONAL_STORAGE !== "true" || process.env.PERSISTENCE_MODE !== "bridge" || !process.env.INTERNAL_API_TOKEN?.trim()) {
    throw new Error("Cutover requires RELATIONAL_STORAGE=true, PERSISTENCE_MODE=bridge and INTERNAL_API_TOKEN");
  }
  const url = new URL(apiUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid API base URL");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]", "api"].includes(url.hostname)) {
    throw new Error("Internal token requires HTTPS outside the local API boundary");
  }
  await database.ping();
  const response = await fetch(new URL("/internal/v1/watch-targets/execution-configs", url), {
    headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN }, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Execution configuration check failed (${response.status})`);
  const configs: unknown = await response.json();
  if (!Array.isArray(configs) || configs.some((row: unknown) => !row || typeof row !== "object" ||
    typeof (row as Record<string, unknown>).id !== "string" || typeof (row as Record<string, unknown>).enabled !== "boolean")) {
    throw new Error("Invalid execution configuration response");
  }
  const hashes = async () => {
    const snapshot = await inspectSnapshot(source);
    if (snapshot.errors.length) throw new Error("Invalid domain JSON observation source");
    return canonical(FILES.slice(0, 3).map((file) => digest(snapshot.bytes[file]!)));
  };
  const before = await hashes();
  await new Promise((done) => setTimeout(done, observationMs));
  if (before !== await hashes()) throw new Error("Domain JSON changed while bridge mode was declared active");
  if (outboxDir !== undefined) {
    const outbox = await stat(outboxDir).catch(() => undefined);
    if (!outbox?.isDirectory()) throw new Error("Worker outbox directory does not exist or is not a directory");
    for (const [directory, message] of [
      ["pending", "Worker outbox has pending events; drain outbox before cutover"],
      ["active", "Worker outbox has unresolved active recording checkpoints; settle captures before cutover"],
    ]) {
      const path = join(outboxDir, directory);
      const metadata = await stat(path).catch(() => undefined);
      if (!metadata?.isDirectory()) throw new Error(`Worker outbox ${directory} directory does not exist or is not a directory`);
      const files = await readdir(path);
      if (files.some((file) => file.endsWith(".json"))) throw new Error(message);
    }
    return { outcome: "cutover-readiness-verified", executionConfigs: configs.length, outboxStatus: "drained", observationMs,
      limitation: "Bounded observation is not proof of Worker liveness; exercise a synthetic lifecycle and verify actual process environments" };
  }
  return { outcome: "api-database-ready", executionConfigs: configs.length, outboxStatus: "unverified", observationMs,
    limitation: "API and database are ready, but Worker outbox and bridge drain were not inspected; pass --outbox to verify drained outbox before final cutover" };
}