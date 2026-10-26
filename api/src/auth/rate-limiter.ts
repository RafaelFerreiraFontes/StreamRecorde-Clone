import { HttpException } from "@nestjs/common";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class LoginRateLimiter {
  private readonly entries = new Map<string, { count: number; expires: number }>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly maxEntries = 10000,
  ) {}

  attempt(address: string): void {
    const now = this.now().getTime();
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
    let entry = this.entries.get(address);
    if (!entry) {
      if (this.entries.size >= this.maxEntries)
        throw new HttpException({ message: "Too many login attempts" }, 429);
      entry = { count: 0, expires: now + LOGIN_WINDOW_MS };
      this.entries.set(address, entry);
    }
    if (++entry.count > 20) throw new HttpException({ message: "Too many login attempts" }, 429);
  }
}
