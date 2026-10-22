import { parseArgs } from "node:util";
import { DatabaseService } from "../database/database.service";
import { backup, importSnapshot, verifySnapshot } from "./migrator";
import { inspectSnapshot } from "./snapshot";
import { cutoverCheck } from "./cutover";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: "string" },
      destination: { type: "string" },
      snapshot: { type: "string" },
      outbox: { type: "string" },
      manifest: { type: "string" },
      quiesced: { type: "boolean" },
      "api-url": { type: "string" },
      "observation-ms": { type: "string" },
    },
  });
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Explicit --${key} is required`);
    return value;
  };
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !["dry-run", "backup", "import", "verify", "cutover-check"].includes(command)
  ) {
    throw new Error(
      "Expected dry-run, backup, import, verify or cutover-check with explicit paths",
    );
  }
  if (command === "dry-run") {
    const { errors, warnings, counts } = await inspectSnapshot(required("source"));
    console.log(JSON.stringify({ errors, warnings, counts }, null, 2));
    if (errors.length) process.exitCode = 1;
    return;
  }
  if (command === "backup") {
    const manifest = await backup(
      required("source"),
      required("destination"),
      values.quiesced === true,
    );
    console.log(
      JSON.stringify({
        outcome: "backup-created",
        fingerprint: manifest.fingerprint,
        counts: manifest.counts,
      }),
    );
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("Explicit DATABASE_URL is required");
  const database = new DatabaseService();
  try {
    const result =
      command === "import"
        ? await importSnapshot(
            database.connection,
            required("snapshot"),
            required("manifest"),
            values.quiesced === true,
          )
        : command === "verify"
          ? await verifySnapshot(database.connection, required("snapshot"), required("manifest"))
          : await cutoverCheck(
              database,
              required("source"),
              required("api-url"),
              (() => {
                const duration = Number(required("observation-ms"));
                if (!Number.isInteger(duration) || duration < 1000 || duration > 600000)
                  throw new Error("Observation must be 1000..600000 milliseconds");
                return duration;
              })(),
              values.outbox === undefined ? undefined : required("outbox"),
            );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await database.onModuleDestroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const safe =
    /^(Snapshot validation failed:|Snapshot drift|Manifest count conflict|Invalid or conflicting manifest|Existing manifest ledger conflict|Destination conflict:|Missing or conflicting import ledger|Database entity count mismatch|Database ID, relationship|Confirm stopped|Import requires|Backup must|Source changed|Explicit --|Explicit DATABASE_URL|Expected dry-run|Observation must|Cutover requires|Invalid API base URL|Internal token requires|Execution configuration check failed|Invalid execution configuration response|Invalid domain JSON observation source|Domain JSON changed)/.test(
      message,
    );
  console.error(
    JSON.stringify({
      error:
        safe || message.startsWith("Worker outbox has ")
          ? message
          : "Legacy migration command failed (filesystem, database or transport)",
      action:
        "Check explicit paths, snapshot validation/checksums, quiescence, destination conflicts and service readiness; no automatic fallback or cleanup was performed",
    }),
  );
  process.exitCode = 1;
});
