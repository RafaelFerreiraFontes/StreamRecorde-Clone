import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvePython() {
  if (process.env.PYTHON) {
    return { cmd: process.env.PYTHON, args: [] };
  }

  const venvCandidates = [
    join(root, ".venv", "Scripts", "python.exe"),
    join(root, ".venv", "bin", "python"),
  ];
  for (const candidate of venvCandidates) {
    if (existsSync(candidate)) {
      return { cmd: candidate, args: [] };
    }
  }

  if (process.platform === "win32") {
    const pyProbe = spawnSync("py", ["-3.12", "-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (pyProbe.status === 0 && pyProbe.stdout.trim()) {
      return { cmd: "py", args: ["-3.12"] };
    }
  }

  return { cmd: "python", args: [] };
}

const { cmd, args } = resolvePython();

const unittest = spawnSync(
  cmd,
  [...args, "-m", "unittest", "discover", "-s", "worker", "-p", "test_*.py"],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (unittest.status !== 0) {
  process.exit(unittest.status ?? 1);
}

const pytest = spawnSync(cmd, [...args, "-m", "pytest", "worker/test_worker.py"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

process.exit(pytest.status ?? 0);
