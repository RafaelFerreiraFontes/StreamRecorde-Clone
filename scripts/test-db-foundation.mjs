import { spawnSync } from "node:child_process";

const compose = ["compose", "-f", "compose.test-db.yml", "-p", "streamrecorder-test-db"];
const databaseUrl = "postgresql://streamrecorder_test:streamrecorder_test_local@127.0.0.1:55432/streamrecorder_test";

function run(command, args, environment = process.env, cwd) {
  const result = spawnSync(command, args, { stdio: "inherit", env: environment, cwd });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

try {
  run("docker", [...compose, "up", "-d", "--wait"]);
  run(process.execPath, ["-r", "ts-node/register", "src/database/migrate.ts"], { ...process.env, DATABASE_URL: databaseUrl }, "api");
  run(process.execPath, ["scripts/test-db-integration.mjs"], { ...process.env, DATABASE_URL: databaseUrl, BRIDGE_TEST_DB_RESTART: "true" }, "api");
  run(process.execPath, ["scripts/database-persistence-check.mjs", "--seed"], { ...process.env, DATABASE_URL: databaseUrl }, "api");
  run("docker", [...compose, "stop", "postgres-test"]);
  run("docker", [...compose, "rm", "-sf", "postgres-test"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres-test"]);
  run(process.execPath, ["scripts/database-persistence-check.mjs"], { ...process.env, DATABASE_URL: databaseUrl }, "api");
} finally {
  run("docker", [...compose, "down", "--volumes"]);
}