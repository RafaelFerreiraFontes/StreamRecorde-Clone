import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { PublicUserIdentity } from "./principal";
import { verifyDummyPassword, verifyPassword } from "./credentials";
import { LOGIN_WINDOW_MS } from "./rate-limiter";

export const IDLE_MS = 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 7 * IDLE_MS;
export const SLIDING_MS = 5 * 60 * 1000;
export const tokenHash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

type UserRow = PublicUserIdentity & {
  password_hash: string | null;
  disabled_at: Date | null;
  locked_until: Date | null;
};
type SessionRow = PublicUserIdentity & {
  session_id: string;
  last_used_at: Date;
  absolute_expires_at: Date;
};
const publicUser = (row: PublicUserIdentity): PublicUserIdentity => ({
  id: row.id,
  username: row.username,
  email: row.email,
});

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async localUser(): Promise<PublicUserIdentity> {
    return this.database.transaction(async (client) => {
      const id = await this.database.resolveBootstrapLocalUser(client);
      const result = await client.query<PublicUserIdentity>(
        "SELECT id, username, email FROM users WHERE id=$1",
        [id],
      );
      return publicUser(result.rows[0]);
    });
  }

  async login(
    username: string,
    password: string,
    token: string,
    previous: string | undefined,
    now: Date,
  ): Promise<PublicUserIdentity | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<UserRow>(
        "SELECT id, username, email, password_hash, disabled_at, locked_until FROM users WHERE username=$1 FOR UPDATE",
        [username],
      );
      const user = result.rows[0];
      if (!user || (user.locked_until && user.locked_until > now)) {
        await verifyDummyPassword(password);
        return null;
      }
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        await client.query(
          `UPDATE users SET
          failed_login_count = CASE WHEN locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END,
          locked_until = CASE WHEN (CASE WHEN locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END) >= 10 THEN $3::timestamptz ELSE NULL END,
          updated_at=$2 WHERE id=$1`,
          [user.id, now, new Date(now.getTime() + LOGIN_WINDOW_MS)],
        );
        return null;
      }
      if (user.disabled_at) return null;
      await client.query(
        "UPDATE users SET failed_login_count=0, locked_until=NULL, updated_at=$2 WHERE id=$1",
        [user.id, now],
      );
      await client.query(
        "DELETE FROM sessions WHERE idle_expires_at <= $1 OR absolute_expires_at <= $1",
        [now],
      );
      if (previous)
        await client.query(
          "UPDATE sessions SET revoked_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL",
          [tokenHash(previous), now],
        );
      await client.query(
        `INSERT INTO sessions (id,user_id,token_hash,created_at,last_used_at,idle_expires_at,absolute_expires_at)
        VALUES ($1,$2,$3,$4,$4,$5,$6)`,
        [
          randomUUID(),
          user.id,
          tokenHash(token),
          now,
          new Date(now.getTime() + IDLE_MS),
          new Date(now.getTime() + ABSOLUTE_MS),
        ],
      );
      return publicUser(user);
    });
  }

  async session(
    token: string,
    now: Date,
    revoke = false,
  ): Promise<{ user: PublicUserIdentity; sessionId: string } | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT u.id, u.username, u.email, s.id AS session_id, s.last_used_at, s.absolute_expires_at
        FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND u.disabled_at IS NULL
          AND s.idle_expires_at > $2 AND s.absolute_expires_at > $2 FOR UPDATE OF u, s`,
        [tokenHash(token), now],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (revoke)
        await client.query("UPDATE sessions SET revoked_at=$2 WHERE id=$1", [row.session_id, now]);
      else if (now.getTime() - row.last_used_at.getTime() >= SLIDING_MS) {
        await client.query("UPDATE sessions SET last_used_at=$2, idle_expires_at=$3 WHERE id=$1", [
          row.session_id,
          now,
          new Date(Math.min(row.absolute_expires_at.getTime(), now.getTime() + IDLE_MS)),
        ]);
      }
      return { user: publicUser(row), sessionId: row.session_id };
    });
  }
}
