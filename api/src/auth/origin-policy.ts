import { ForbiddenException } from "@nestjs/common";

export type OriginHeaders = { origin?: string; referer?: string };

export function parseTrustedOrigins(value?: string): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(value.split(",").map((entry) => {
    const origin = entry.trim();
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || origin.includes("*")) throw new Error();
    } catch {
      throw new Error("Invalid AUTH_TRUSTED_ORIGINS configuration");
    }
    return origin;
  }));
}

export function requireTrustedOrigin(headers: OriginHeaders, trusted: Set<string>): string {
  try {
    const input = headers.origin ?? headers.referer;
    if (!input) throw new Error();
    const url = new URL(input);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new Error();
    if (headers.origin !== undefined && input !== url.origin) throw new Error();
    if (!trusted.has(url.origin)) throw new Error();
    return url.origin;
  } catch {
    throw new ForbiddenException("Untrusted origin");
  }
}