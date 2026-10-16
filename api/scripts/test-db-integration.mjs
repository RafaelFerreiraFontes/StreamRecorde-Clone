import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to the isolated test database");
}

const result = spawnSync(
  process.execPath,
  [
    "./node_modules/jest/bin/jest.js",
    "database/test/database.integration.spec.ts",
    "--runInBand",
  ],
  { stdio: "inherit", env: process.env },
);

process.exitCode = result.status ?? 1;