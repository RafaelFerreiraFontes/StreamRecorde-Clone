export function sessionCookie(token: string, origin: string, clear = false): string {
  return `sr_session=${clear ? "" : token}; HttpOnly; Path=/; SameSite=Lax${clear ? "; Max-Age=0" : ""}${origin.startsWith("https://") ? "; Secure" : ""}`;
}

export function readSessionToken(cookie?: string): string | undefined {
  const values = cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith("sr_session="));
  if (values?.length !== 1) return undefined;
  const token = values[0].slice("sr_session=".length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}