export function resolveIdentityMode(env: NodeJS.ProcessEnv): "local" | "authenticated" {
  const mode = env.IDENTITY_MODE;
  if (mode === undefined || mode === "" || mode === "local") return "local";
  if (mode === "authenticated") return "authenticated";
  throw new Error(`Invalid IDENTITY_MODE "${mode}": expected "local" or "authenticated"`);
}

export function validateStartupIdentityMode(env: NodeJS.ProcessEnv): "local" {
  if (resolveIdentityMode(env) === "authenticated") {
    throw new Error("authenticated mode not yet available");
  }
  return "local";
}
