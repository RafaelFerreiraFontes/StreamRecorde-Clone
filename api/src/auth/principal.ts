export type PublicUserIdentity = { id: string; username: string; email: string | null };

export type HumanPrincipal =
  | { kind: "local-json"; identityMode: "local"; persistence: "json"; user: null }
  | {
      kind: "local-relational";
      identityMode: "local";
      persistence: "relational";
      user: PublicUserIdentity;
    }
  | {
      kind: "authenticated";
      identityMode: "authenticated";
      persistence: "relational";
      user: PublicUserIdentity;
      sessionId: string;
    };

export type Principal = HumanPrincipal | { kind: "worker-service" };

export function identitySummary(principal: HumanPrincipal) {
  return {
    identityMode: principal.identityMode,
    persistence: principal.persistence,
    user: principal.user,
  };
}
