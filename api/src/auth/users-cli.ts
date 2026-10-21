import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { hashPassword, normalizeEmail, normalizeUsername, validatePasswordInput } from "./credentials";

export type PasswordIO = {
  input: NodeJS.ReadStream;
  output: Pick<NodeJS.WriteStream, "write">;
};

export async function readPassword(io: PasswordIO = { input: process.stdin, output: process.stderr }): Promise<string> {
  const { input, output } = io;
  input.setEncoding("utf8");
  if (!input.isTTY) {
    let value = "";
    for await (const chunk of input) {
      value += chunk.toString();
      if (value.length > 258) throw new Error("Password input too long");
    }
    value = value.replace(/\r?\n$/, "");
    if (/[\r\n]/.test(value)) throw new Error("Expected one password line");
    return validatePasswordInput(value);
  }
  output.write("Password: ");
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    const wasPaused = input.isPaused();
    let value = "";
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write("\n");
      if (error) reject(error);
      else {
        try { resolve(validatePasswordInput(value)); } catch (failure) { reject(failure); }
      }
    };
    const onError = () => finish(new Error("Password input failed"));
    const onEnd = () => finish(new Error("Password input closed"));
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003" || character === "\u0004") return finish(new Error("Password entry cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " " && character !== "\u007f") value += character;
        if (value.length > 256) return finish(new Error("Password input too long"));
      }
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.on("data", onData);
    input.once("error", onError);
    input.once("end", onEnd);
    input.resume();
  });
}

export type UsersCLIOptions = { readPassword?: () => Promise<string>; write?: (value: string) => void };

export async function runUsersCLI(args: string[], database: DatabaseService, options: UsersCLIOptions = {}): Promise<void> {
  const [command, ...rest] = args;
  if (!command || !["create", "set-password", "disable", "enable", "list"].includes(command)) throw new Error("Expected create, set-password, disable, enable or list");
  if (rest.some((value) => /^--?p(?:assword)?(?:=|$)/.test(value))) throw new Error("Passwords must be supplied via stdin or no-echo prompt, never argv");
  const validArgs = command === "list" ? rest.length === 0
    : command === "create" ? rest.length === 1 || (rest.length === 3 && rest[1] === "--email")
      : rest.length === 1;
  if (!validArgs || rest.some((value, index) => value.startsWith("-") && !(command === "create" && index === 1 && value === "--email"))) {
    throw new Error("Unexpected arguments; passwords must never be passed in argv");
  }
  const write = options.write ?? ((value: string) => process.stdout.write(value + "\n"));
  if (command === "list") {
    const rows = await database.transaction(async (client) => (await client.query(`SELECT id, username, email,
      disabled_at IS NULL AS enabled, password_hash IS NOT NULL AS has_password, locked_until, created_at FROM users ORDER BY username`)).rows);
    write(JSON.stringify(rows));
    return;
  }
  const username = normalizeUsername(rest[0]);
  const email = command === "create" ? normalizeEmail(rest[2]) : null;
  const passwordHash = command === "create" || command === "set-password"
    ? await hashPassword(await (options.readPassword ?? readPassword)()) : null;
  const user = await database.transaction(async (client) => {
    if (command === "create") {
      return (await client.query("INSERT INTO users (id,username,email,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,username,email", [randomUUID(), username, email, passwordHash])).rows[0];
    }
    if (command === "set-password" && username === "local") await database.resolveBootstrapLocalUser(client);
    const found = await client.query("SELECT id FROM users WHERE username=$1 FOR UPDATE", [username]);
    if (!found.rows[0]) return null;
    const id = found.rows[0].id;
    if (command === "set-password") await client.query("UPDATE users SET password_hash=$2, failed_login_count=0, locked_until=NULL, updated_at=NOW() WHERE id=$1", [id, passwordHash]);
    if (command === "disable") {
      await client.query("UPDATE users SET disabled_at=NOW(), updated_at=NOW() WHERE id=$1", [id]);
      await client.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    }
    if (command === "enable") await client.query("UPDATE users SET disabled_at=NULL, failed_login_count=0, locked_until=NULL, updated_at=NOW() WHERE id=$1", [id]);
    return (await client.query("SELECT id,username,email FROM users WHERE id=$1", [id])).rows[0];
  });
  if (!user) throw new Error("User not found");
  write(JSON.stringify(user));
}

if (require.main === module) {
  const database = new DatabaseService();
  runUsersCLI(process.argv.slice(2), database).catch(() => {
    process.stderr.write("User command failed. Check arguments, input, account uniqueness and database availability. Passwords must use stdin or a no-echo prompt, never argv.\n");
    process.exitCode = 1;
  }).finally(() => database.onModuleDestroy());
}