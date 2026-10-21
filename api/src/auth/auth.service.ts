import { Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { resolveIdentityMode } from "../database/identity-mode";
import { AuthRepository } from "./auth.repository";
import { normalizeUsername, validatePasswordInput, verifyDummyPassword } from "./credentials";
import { HumanPrincipal } from "./principal";
import { OriginHeaders, parseTrustedOrigins, requireTrustedOrigin } from "./origin-policy";
import { LoginRateLimiter } from "./rate-limiter";
import { readSessionToken } from "./session-cookie";

export const AUTH_OPTIONS = Symbol("AUTH_OPTIONS");
export type AuthOptions = { env?: NodeJS.ProcessEnv; now?: () => Date };

@Injectable()
export class AuthService {
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly limiter: LoginRateLimiter;

  constructor(private readonly repository: AuthRepository, @Optional() @Inject(AUTH_OPTIONS) options?: AuthOptions) {
    this.env = options?.env ?? process.env;
    this.now = options?.now ?? (() => new Date());
    this.limiter = new LoginRateLimiter(this.now);
  }

  requireUnsafeOrigin(headers: OriginHeaders): string {
    return requireTrustedOrigin(headers, parseTrustedOrigins(this.env.AUTH_TRUSTED_ORIGINS));
  }

  private authenticatedOnly(): void {
    if (this.identityMode() === "local") throw new NotFoundException();
    this.requireRelational();
  }

  private identityMode(): "local" | "authenticated" {
    try { return resolveIdentityMode(this.env); }
    catch { throw new ServiceUnavailableException("Database unavailable"); }
  }

  private requireRelational(): void {
    if (this.env.RELATIONAL_STORAGE !== "true" || this.env.IDENTITY_MODE !== "authenticated") throw new ServiceUnavailableException("Database unavailable");
  }

  private async database<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new ServiceUnavailableException("Database unavailable"); }
  }

  async login(body: unknown, headers: OriginHeaders, address: string, cookie?: string) {
    this.authenticatedOnly();
    const origin = this.requireUnsafeOrigin(headers);
    this.limiter.attempt(address);
    let username: string;
    let password: string;
    try {
      const input = body as { username?: unknown; password?: unknown } | null;
      if (typeof input?.username !== "string") throw new Error();
      username = normalizeUsername(input.username);
      password = validatePasswordInput(input.password);
    } catch {
      await verifyDummyPassword();
      throw new UnauthorizedException({ message: "Invalid credentials" });
    }
    const token = randomBytes(32).toString("base64url");
    const user = await this.database(() => this.repository.login(username, password, token, readSessionToken(cookie), this.now()));
    if (!user) throw new UnauthorizedException({ message: "Invalid credentials" });
    return { user, token, origin };
  }

  async resolvePrincipal(cookie?: string): Promise<HumanPrincipal> {
    if (this.identityMode() === "local") {
      if (this.env.RELATIONAL_STORAGE !== "true") return { kind: "local-json", identityMode: "local", persistence: "json", user: null };
      const user = await this.database(() => this.repository.localUser());
      return { kind: "local-relational", identityMode: "local", persistence: "relational", user };
    }
    this.requireRelational();
    const token = readSessionToken(cookie);
    const session = token ? await this.database(() => this.repository.session(token, this.now())) : null;
    if (!session) throw new UnauthorizedException("Invalid or expired session");
    return { kind: "authenticated", identityMode: "authenticated", persistence: "relational", ...session };
  }

  async logout(headers: OriginHeaders, cookie?: string): Promise<string> {
    this.authenticatedOnly();
    const origin = this.requireUnsafeOrigin(headers);
    const token = readSessionToken(cookie);
    const session = token ? await this.database(() => this.repository.session(token, this.now(), true)) : null;
    if (!session) throw new UnauthorizedException("Invalid or expired session");
    return origin;
  }
}