import { BadRequestException } from "@nestjs/common";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummySalt = Buffer.alloc(16, 37);
const dummyHash = Buffer.from("RXFRjVH1POj6ObXMI2ry3IdynKBZSFJrQVgKMIYEZe0sWwsgIeaob/NiAHWX+GElrYLfHr10KIdvoBjHQN3A0Q==", "base64");

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export function normalizeUsername(input: string): string {
  const username = input.trim().normalize("NFKC").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new BadRequestException("Invalid username");
  return username;
}

export function normalizeEmail(input?: string | null): string | null {
  const email = input?.trim().normalize("NFKC").toLowerCase();
  if (!email) return null;
  if (!/^[^\s\x00-\x1f\x7f@]+@[^\s\x00-\x1f\x7f@]+$/.test(email)) throw new BadRequestException("Invalid email");
  return email;
}

export function validatePasswordInput(password: unknown): string {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new BadRequestException("Password must contain 12 to 256 characters");
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordInput(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$v1$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyDummyPassword(password?: string): Promise<false> {
  const key = await derive(typeof password === "string" && password.length <= 256 ? password : "dummy-password", dummySalt);
  timingSafeEqual(key, dummyHash);
  return false;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash || typeof password !== "string" || !password.length || password.length > 256) return verifyDummyPassword(password);
  const parts = storedHash.split("$");
  if (parts.length !== 7 || parts.slice(0, 5).join("$") !== "scrypt$v1$32768$8$1") return verifyDummyPassword(password);
  const salt = Buffer.from(parts[5], "base64");
  const expected = Buffer.from(parts[6], "base64");
  if (salt.length !== 16 || expected.length !== 64 || salt.toString("base64") !== parts[5] || expected.toString("base64") !== parts[6]) {
    return verifyDummyPassword(password);
  }
  return timingSafeEqual(await derive(password, salt), expected);
}