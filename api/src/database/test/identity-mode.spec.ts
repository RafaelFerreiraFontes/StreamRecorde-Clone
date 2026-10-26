import type { Pool } from "pg";
import { resolveIdentityMode, validateStartupIdentityMode } from "../identity-mode";

const authenticated = {
  IDENTITY_MODE: "authenticated",
  RELATIONAL_STORAGE: "true",
  DATABASE_URL: "postgresql://user:synthetic-secret@localhost/test",
  AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
};
const success = () => jest.fn().mockResolvedValue({ rows: [{}] });

describe("identity mode startup prerequisites", () => {
  it.each([undefined, "", "local"])(
    "accepts local %p without touching a database",
    async (mode) => {
      const queryRunner = success();
      await expect(
        validateStartupIdentityMode({ IDENTITY_MODE: mode }, { queryRunner }),
      ).resolves.toBe("local");
      expect(queryRunner).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid modes", async () => {
    expect(() => resolveIdentityMode({ IDENTITY_MODE: "invalid" })).toThrow(
      'Invalid IDENTITY_MODE "invalid"',
    );
    await expect(validateStartupIdentityMode({ IDENTITY_MODE: "invalid" })).rejects.toThrow(
      'Invalid IDENTITY_MODE "invalid"',
    );
  });
  it.each([undefined, "false", "TRUE"])("rejects storage %p", async (storage) => {
    await expect(
      validateStartupIdentityMode({ ...authenticated, RELATIONAL_STORAGE: storage }),
    ).rejects.toThrow("Authenticated mode requires RELATIONAL_STORAGE=true");
  });
  it.each([undefined, "", "not a url", "https://example.test", "postgresql://"])(
    "rejects database URL %p",
    async (url) => {
      await expect(
        validateStartupIdentityMode({ ...authenticated, DATABASE_URL: url }),
      ).rejects.toThrow("Authenticated mode requires a valid PostgreSQL DATABASE_URL");
    },
  );
  it.each([undefined, "", " ", "*", "http://localhost:3000/path"])(
    "rejects trusted origins %p",
    async (origins) => {
      await expect(
        validateStartupIdentityMode({ ...authenticated, AUTH_TRUSTED_ORIGINS: origins }),
      ).rejects.toThrow(/AUTH_TRUSTED_ORIGINS/);
    },
  );
  it("sanitizes connection errors and closes the pool", async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error(authenticated.DATABASE_URL)),
      end: jest.fn().mockResolvedValue(undefined),
    };
    await expect(
      validateStartupIdentityMode(authenticated, { pool: pool as unknown as Pool }),
    ).rejects.toThrow("Database connection failed: PostgreSQL is unreachable or access was denied");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
  it.each(["table", "ownership column", "composite constraint"])(
    "rejects a missing %s",
    async () => {
      const queryRunner = success()
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [] });
      await expect(validateStartupIdentityMode(authenticated, { queryRunner })).rejects.toThrow(
        "Database schema missing required Wave 05.5 tables, ownership columns, or composite constraints",
      );
    },
  );
  it.each(["no users", "disabled users", "unenrolled users"])("rejects %s", async () => {
    const queryRunner = success()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(validateStartupIdentityMode(authenticated, { queryRunner })).rejects.toThrow(
      "Authenticated mode requires at least one enabled user with an enrolled password",
    );
    expect(queryRunner).toHaveBeenLastCalledWith(
      "SELECT 1 FROM users WHERE disabled_at IS NULL AND password_hash IS NOT NULL LIMIT 1;",
    );
  });
  it("sanitizes errors during checks and cleans up", async () => {
    const pool = {
      query: success()
        .mockResolvedValueOnce({ rows: [{}] })
        .mockRejectedValueOnce(new Error("synthetic-secret")),
      end: jest.fn().mockResolvedValue(undefined),
    };
    await expect(
      validateStartupIdentityMode(authenticated, { pool: pool as unknown as Pool }),
    ).rejects.toThrow("Database startup prerequisite check failed");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
  it("accepts PostgreSQL local without database checks", async () => {
    await expect(
      validateStartupIdentityMode({ RELATIONAL_STORAGE: "true", IDENTITY_MODE: "local" }),
    ).resolves.toBe("local");
  });
  it("accepts authenticated prerequisites and closes its pool", async () => {
    const pool = { query: success(), end: jest.fn().mockResolvedValue(undefined) };
    await expect(
      validateStartupIdentityMode(authenticated, { pool: pool as unknown as Pool }),
    ).resolves.toBe("authenticated");
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
  it("supports a query runner without creating a pool", async () => {
    await expect(
      validateStartupIdentityMode(authenticated, { queryRunner: success() }),
    ).resolves.toBe("authenticated");
  });
});
