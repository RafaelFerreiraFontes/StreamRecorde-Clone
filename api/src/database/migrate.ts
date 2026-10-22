import { DatabaseService } from "./database.service";

async function main(): Promise<void> {
  const database = new DatabaseService();
  try {
    await database.migrate();
  } finally {
    await database.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Database migration failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
