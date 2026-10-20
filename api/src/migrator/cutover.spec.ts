import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseService } from "../database/database.service";
import { cutoverCheck } from "./cutover";
import * as inspect from "./snapshot";

describe("cutover checkpoint", () => {
  let directory: string;
  const originalEnv = { ...process.env };
  const database = { ping: jest.fn(async () => undefined) } as unknown as DatabaseService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cutover-"));
    await Promise.all(["watchlist.json", "streams.json", "sessions.json"].map((file) => writeFile(join(directory, file), "[]")));
    process.env.RELATIONAL_STORAGE = "true";
    process.env.PERSISTENCE_MODE = "bridge";
    process.env.INTERNAL_API_TOKEN = "synthetic-test-token";
  });
  afterEach(async () => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  it("requires paired authority flags and a token", async () => {
    delete process.env.INTERNAL_API_TOKEN;
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1)).rejects.toThrow(/Cutover requires/);
  });
  it("checks readiness and bounded domain stability without writing sources", async () => {
    const request = jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1)).resolves.toMatchObject({ outcome: "api-database-ready", outboxStatus: "unverified" });
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error" }));
  });
  it("rejects unavailable execution configs", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1)).rejects.toThrow(/503/);
  });
  it.each(["missing", "file"])("rejects a %s outbox root", async (kind) => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const outbox = join(directory, "outbox");
    if (kind === "file") await writeFile(outbox, "{}");
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1, outbox)).rejects.toThrow("Worker outbox directory does not exist or is not a directory");
  });
  it.each([
    ["pending", "missing"], ["active", "missing"],
    ["pending", "file"], ["active", "file"],
  ])("rejects a %s outbox subdirectory that is %s", async (folder, kind) => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const outbox = join(directory, "outbox");
    await mkdir(join(outbox, folder === "pending" ? "active" : "pending"), { recursive: true });
    if (kind === "file") await writeFile(join(outbox, folder), "{}");
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1, outbox)).rejects.toThrow(`Worker outbox ${folder} directory does not exist or is not a directory`);
  });
  it("verifies a drained outbox", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const outbox = join(directory, "outbox");
    await mkdir(join(outbox, "pending"), { recursive: true });
    await mkdir(join(outbox, "active"));
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1, outbox)).resolves.toMatchObject({
      outcome: "cutover-readiness-verified", outboxStatus: "drained", executionConfigs: 0,
    });
  });
  it.each([
    ["pending", "Worker outbox has pending events"],
    ["active", "unresolved active recording checkpoints"],
  ])("rejects unresolved %s outbox files", async (folder, message) => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const outbox = join(directory, "outbox");
    await mkdir(join(outbox, "pending"), { recursive: true });
    await mkdir(join(outbox, "active"));
    await writeFile(join(outbox, folder, "event.json"), "{}");
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1, outbox)).rejects.toThrow(message);
  });
  it("rejects domain writes during bridge observation", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const actual = inspect.inspectSnapshot;
    let calls = 0;
    jest.spyOn(inspect, "inspectSnapshot").mockImplementation(async (source) => {
      calls += 1;
      if (calls === 2) await writeFile(join(directory, "sessions.json"), "[ ]");
      return actual(source);
    });
    await expect(cutoverCheck(database, directory, "http://127.0.0.1:3000", 1)).rejects.toThrow(/Domain JSON changed/);
  });
});