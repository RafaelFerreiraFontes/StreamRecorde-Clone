import { resolveIdentityMode, validateStartupIdentityMode } from "../identity-mode";

describe("identity mode", () => {
  it.each([undefined, "", "local"])("defaults to or accepts local for %p", (mode) => {
    const env = mode === undefined ? {} : { IDENTITY_MODE: mode };
    expect(resolveIdentityMode(env)).toBe("local");
    expect(validateStartupIdentityMode(env)).toBe("local");
  });

  it("resolves authenticated but rejects it at startup", () => {
    const env = { IDENTITY_MODE: "authenticated" };
    expect(resolveIdentityMode(env)).toBe("authenticated");
    expect(() => validateStartupIdentityMode(env)).toThrow("authenticated mode not yet available");
  });

  it("rejects invalid modes without falling back to local", () => {
    const env = { IDENTITY_MODE: "invalid_mode" };
    const message = 'Invalid IDENTITY_MODE "invalid_mode": expected "local" or "authenticated"';
    expect(() => resolveIdentityMode(env)).toThrow(message);
    expect(() => validateStartupIdentityMode(env)).toThrow(message);
  });

  it.each([undefined, "false"])("validates JSON mode without a database when RELATIONAL_STORAGE is %p", (storage) => {
    const env: NodeJS.ProcessEnv = storage === undefined ? {} : { RELATIONAL_STORAGE: storage };
    expect(validateStartupIdentityMode({ ...env, IDENTITY_MODE: "local" })).toBe("local");
    expect(() => validateStartupIdentityMode({ ...env, IDENTITY_MODE: "authenticated" }))
      .toThrow("authenticated mode not yet available");
  });
});