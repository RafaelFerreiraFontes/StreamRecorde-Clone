import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const area = process.argv[3] ?? "all";
if (
  !["lint", "lint:fix", "format:check", "format:write"].includes(mode) ||
  !["all", "scripts", "api", "frontend", "worker"].includes(area)
) {
  throw new Error(
    "Usage: node scripts/lint-repository.mjs <lint|lint:fix|format:check|format:write> [all|scripts|api|frontend|worker]",
  );
}
let failed = false;
function run(command, args, cwd = root) {
  console.log(`\n${area}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
  });
  if (result.error) console.error(`Required tool could not run: ${result.error.message}`);
  if (result.error || result.status !== 0) failed = true;
}
function files(directory, extensions) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${relative}`);
    if (entry.isDirectory()) return files(relative, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [relative] : [];
  });
}
const scopes = {
  scripts: [
    ...files("scripts", [".mjs", ".js", ".cjs"]),
    "eslint.config.mjs",
    "package.json",
    ".prettierrc.json",
    "README-LINTING.md",
  ],
  api: [
    ...["api/src", "api/scripts", "api/test"].flatMap((dir) =>
      files(dir, [".ts", ".mjs", ".js", ".json"]),
    ),
    "api/eslint.config.mjs",
    "api/drizzle.config.ts",
    "api/package.json",
    "api/tsconfig.json",
    "api/tsconfig.build.json",
    "api/nest-cli.json",
  ],
  frontend: [
    ...["frontend/app", "frontend/components", "frontend/lib", "frontend/tests"].flatMap((dir) =>
      files(dir, [".ts", ".tsx", ".mjs", ".js", ".css", ".json"]),
    ),
    "frontend/eslint.config.mjs",
    "frontend/next.config.ts",
    "frontend/postcss.config.mjs",
    "frontend/package.json",
    "frontend/tsconfig.json",
  ],
};
for (const component of area === "all" ? ["scripts", "api", "frontend", "worker"] : [area]) {
  if (component === "worker") {
    const python =
      process.env.RUFF_PYTHON ??
      [".venv/Scripts/python.exe", ".venv/bin/python"]
        .map((path) => join(root, path))
        .find(existsSync) ??
      "python";
    const targets = ["worker", "scripts/docker-smoke/streamlink-fixture.py"];
    const version = spawnSync(python, ["-m", "ruff", "--version"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (version.error || version.status !== 0 || version.stdout.trim() !== "ruff 0.15.6") {
      console.error(
        "Ruff 0.15.6 is required. Install worker/requirements-dev.txt with the RUFF_PYTHON interpreter, or the repository .venv.",
      );
      failed = true;
      continue;
    }
    run(python, [
      "-m",
      "ruff",
      ...(mode.startsWith("lint")
        ? ["check", ...(mode === "lint:fix" ? ["--fix"] : [])]
        : ["format", ...(mode === "format:check" ? ["--check"] : [])]),
      "--config",
      "worker/ruff.toml",
      ...targets,
    ]);
  } else if (mode.startsWith("lint")) {
    const cwd = component === "scripts" ? root : join(root, component);
    const targets =
      component === "scripts"
        ? ["scripts", "eslint.config.mjs"]
        : component === "api"
          ? ["src", "scripts", "eslint.config.mjs", "drizzle.config.ts"]
          : [
              "app",
              "components",
              "lib",
              "tests",
              "eslint.config.mjs",
              "next.config.ts",
              "postcss.config.mjs",
            ];
    run(
      process.execPath,
      [
        join(cwd, "node_modules/eslint/bin/eslint.js"),
        ...targets,
        "--max-warnings",
        "0",
        ...(mode === "lint:fix" ? ["--fix"] : []),
      ],
      cwd,
    );
  } else {
    run(process.execPath, [
      join(root, "node_modules/prettier/bin/prettier.cjs"),
      mode === "format:check" ? "--check" : "--write",
      "--config",
      join(root, ".prettierrc.json"),
      ...scopes[component].filter((path) => existsSync(join(root, path))),
    ]);
  }
}
process.exitCode = failed ? 1 : 0;
