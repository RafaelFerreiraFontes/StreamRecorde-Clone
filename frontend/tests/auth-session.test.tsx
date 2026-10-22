import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";
import type { AuthSession } from "../lib/types";
import { useEffect } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.defineProperties(globalThis, {
  self: { configurable: true, value: dom.window },
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLDialogElement: { configurable: true, value: dom.window.HTMLDialogElement },
});
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const { render, cleanup, screen, waitFor, fireEvent, act } = await import("@testing-library/react");
const { DashboardProvider, useDashboard } = await import("../components/provider");
const { Shell } = await import("../components/shell");
const { RecordingBrowser } = await import("../components/recording-browser");
const { default: WatchTargets } = await import("../app/watch-targets/page");
const { requestLog } = await import("../lib/api");
const originalFetch = globalThis.fetch;
let dashboard: ReturnType<typeof useDashboard>;
const alice: AuthSession = {
  identityMode: "authenticated",
  persistence: "relational",
  user: { id: "alice", username: "Alice", email: null },
};
const bob: AuthSession = { ...alice, user: { id: "bob", username: "Bob", email: null } };
const signedOut: AuthSession = { ...alice, user: null };
const local: AuthSession = { identityMode: "local", persistence: "json", user: null };
function Capture() {
  const value = useDashboard();
  useEffect(() => {
    dashboard = value;
  }, [value]);
  return null;
}
function Domain() {
  const { snapshot } = useDashboard();
  return <div data-testid="domain">{JSON.stringify(snapshot)}</div>;
}
function mount(children: React.ReactNode = <Domain />) {
  return render(
    <DashboardProvider>
      <Capture />
      <Shell>{children}</Shell>
    </DashboardProvider>,
  );
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  requestLog.clear();
});

test("initial session gates domain mounting and local JSON/relational modes do not prompt for login", async () => {
  for (const session of [local, { ...local, persistence: "relational", user: alice.user }]) {
    const pending = deferred();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return String(input).endsWith("/auth/session") ? pending.promise : Response.json([]);
    };
    const view = mount();
    assert.equal(screen.queryByTestId("domain"), null);
    assert.deepEqual(calls, ["/api/backend/auth/session"]);
    await act(async () => {
      pending.resolve(Response.json(session));
    });
    await screen.findByTestId("domain");
    await waitFor(() => assert.equal(calls.length, 5));
    assert.equal(screen.queryByRole("button", { name: "Sign in" }), null);
    assert.equal(screen.queryByRole("button", { name: "Sign out" }), null);
    view.unmount();
  }
});

test("login uses a generic invalid-credentials error and excludes credentials and response bodies from diagnostics", async () => {
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/auth/session")) return Response.json(signedOut);
    assert.equal(init?.method, "POST");
    return Response.json(
      { message: "SECRET_RESPONSE password=SECRET_PASSWORD sr_session=SECRET_COOKIE" },
      { status: 401 },
    );
  };
  mount();
  await screen.findByRole("button", { name: "Sign in" });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Alice" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SECRET_PASSWORD" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Invalid username or password.");
  assert.equal(screen.queryByTestId("domain"), null);
  assert.equal((screen.getByLabelText("Password") as HTMLInputElement).value, "");
  assert.doesNotMatch(JSON.stringify(requestLog.snapshot()), /SECRET|auth\/login/);
});

test("backend outage never selects local mode and session retry recovers", async () => {
  let unavailable = true;
  const domainCalls: string[] = [];
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/session"))
      return unavailable ? Response.json({}, { status: 502 }) : Response.json(local);
    domainCalls.push(String(input));
    return Response.json([]);
  };
  mount();
  await screen.findByRole("button", { name: "Retry" });
  assert.equal(dashboard.authState, "backend_unavailable");
  assert.deepEqual(domainCalls, []);
  assert.equal(screen.queryByTestId("domain"), null);
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByTestId("domain");
  assert.equal(dashboard.authState, "local");
});

test("logout and a second login discard old refresh, location, mutation, error and diagnostic completions", async () => {
  let identity = alice;
  const delayed: ReturnType<typeof deferred>[] = [];
  let delay = false;
  let oldSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/session")) return Response.json(identity);
    if (path.endsWith("/auth/logout")) {
      identity = signedOut;
      return Response.json({ loggedOut: true });
    }
    if (path.endsWith("/auth/login")) {
      identity = bob;
      return Response.json(bob);
    }
    if (delay && identity.user?.id === "alice") {
      oldSignal = init?.signal;
      const pending = deferred();
      delayed.push(pending);
      return pending.promise;
    }
    return Response.json([{ id: identity.user?.id, display_name: identity.user?.username }]);
  };
  mount();
  await waitFor(() => assert.ok(dashboard.snapshot.creators.data));
  delay = true;
  const generation = dashboard.generation;
  let oldRefresh!: Promise<void>;
  let oldLocation!: Promise<unknown>;
  let oldMutation!: Promise<unknown>;
  await act(async () => {
    oldRefresh = dashboard.refresh();
    oldLocation = dashboard.request("/recordings/alice-recording/location").catch(() => undefined);
    oldMutation = dashboard
      .request("/watch-targets/alice-target", { method: "PATCH", body: "{}" })
      .catch(() => undefined);
  });
  await act(async () => {
    await dashboard.logout();
  });
  assert.ok(oldSignal?.aborted);
  assert.ok(dashboard.generation > generation);
  assert.equal(screen.queryByTestId("domain"), null);
  assert.equal(dashboard.snapshot.creators.data, undefined);
  assert.equal(dashboard.busy, false);
  assert.deepEqual(
    requestLog.snapshot().filter((entry) => !entry.path.startsWith("/auth/")),
    [],
  );
  await act(async () => {
    await dashboard.login("Bob", "synthetic-password");
  });
  await waitFor(() => assert.equal(dashboard.snapshot.creators.data?.[0]?.id, "bob"));
  await act(async () => {
    delayed.forEach((pending, index) =>
      pending.resolve(
        index === 1
          ? Response.json({ message: "Alice private error" }, { status: 401 })
          : Response.json([{ id: "alice-private" }]),
      ),
    );
    await Promise.all([oldRefresh, oldLocation, oldMutation]);
  });
  assert.equal(dashboard.authState, "authenticated");
  assert.equal(dashboard.session?.user?.id, "bob");
  assert.doesNotMatch(screen.getByTestId("domain").textContent ?? "", /alice/i);
  assert.doesNotMatch(JSON.stringify(requestLog.snapshot()), /alice|Alice/);
});

test("ordinary 404 preserves identity but an authenticated request 401 clears collections and stops access", async () => {
  globalThis.fetch = async (input) =>
    String(input).endsWith("/auth/session") ? Response.json(alice) : Response.json([]);
  mount();
  await screen.findByTestId("domain");
  globalThis.fetch = async () => Response.json({ message: "Not found" }, { status: 404 });
  await act(async () => {
    await assert.rejects(dashboard.request("/recordings/missing/location"), /404/);
  });
  assert.equal(dashboard.authState, "authenticated");
  const generation = dashboard.generation;
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  await act(async () => {
    await assert.rejects(
      dashboard.request("/watch-targets/id", { method: "PATCH", body: "{}" }),
      /401/,
    );
  });
  assert.equal(dashboard.authState, "unauthenticated");
  assert.ok(dashboard.generation > generation);
  assert.equal(dashboard.snapshot.creators.data, undefined);
  assert.equal(screen.queryByTestId("domain"), null);
});

test("session refresh changes identity without reusing an earlier user's pending collection refresh", async () => {
  let identity = alice;
  const pending = deferred();
  let oldRequested = false;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/session")) return Response.json(identity);
    if (identity.user?.id === "alice") {
      oldRequested = true;
      return pending.promise;
    }
    return Response.json([{ id: "bob" }]);
  };
  mount();
  await waitFor(() => assert.ok(oldRequested));
  identity = bob;
  await act(async () => {
    await dashboard.retrySession();
  });
  await waitFor(() => assert.equal(dashboard.snapshot.creators.data?.[0]?.id, "bob"));
  await act(async () => {
    pending.resolve(Response.json([{ id: "alice" }]));
  });
  assert.equal(dashboard.snapshot.creators.data?.[0]?.id, "bob");
  identity = signedOut;
  await act(async () => {
    await dashboard.retrySession();
  });
  assert.equal(dashboard.authState, "unauthenticated");
  assert.equal(screen.queryByTestId("domain"), null);
});

test("failed logout hides protected data and offers explicit retry rather than claiming revocation", async () => {
  let failLogout = true;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/session")) return Response.json(alice);
    if (String(input).endsWith("/auth/logout"))
      return Response.json({}, { status: failLogout ? 403 : 200 });
    return Response.json([]);
  };
  mount();
  await screen.findByRole("button", { name: "Sign out" });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText(
    "Sign out could not be confirmed. Retry sign out or verify your session.",
  );
  assert.equal(screen.queryByTestId("domain"), null);
  assert.equal(dashboard.authState, "authentication_error");
  failLogout = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry sign out" }));
  await waitFor(() => assert.equal(dashboard.authState, "unauthenticated"));
});

test("authenticated recording metadata displays status, relative folder and bytes without filesystem calls", async () => {
  for (const status of ["available", "file_not_found", "directory_unavailable"] as const) {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/auth/session")) return Response.json(alice);
      if (path.endsWith("/location"))
        return Response.json({ status, file: "capture.mp4", subdir: "", size: 123 });
      return Response.json([]);
    };
    const view = mount(<RecordingBrowser recordingId="recording" onClose={() => {}} />);
    await screen.findByText("123 bytes");
    assert.ok(screen.getByText("/"));
    assert.match(screen.getByRole("dialog").textContent ?? "", /capture.mp4/);
    assert.equal(screen.queryByRole("navigation", { name: "Recording folder breadcrumbs" }), null);
    assert.ok(!calls.some((path) => path.includes("/filesystem")));
    view.unmount();
  }
});

test("authenticated target folder editing keeps manual entry but disables tree browsing", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith("/auth/session")) return Response.json(alice);
    if (path.endsWith("/watch-targets"))
      return Response.json([
        {
          id: "target",
          creator_id: "creator",
          channel_name: "Channel",
          quality: "best",
          url: "https://example.test",
          enabled: true,
          state: "idle",
        },
      ]);
    return Response.json([]);
  };
  mount(<WatchTargets />);
  await screen.findByRole("button", { name: "Edit recording folder" });
  fireEvent.click(screen.getByRole("button", { name: "Edit recording folder" }));
  assert.ok(screen.getByRole("textbox", { name: "Recording folder" }));
  assert.ok(
    (screen.getByRole("button", { name: "Browse recording folders" }) as HTMLButtonElement)
      .disabled,
  );
  assert.ok(!calls.some((path) => path.includes("/filesystem")));
});

test("pending logout blocks a new login until its cookie-clearing response has completed", async () => {
  const pending = deferred();
  let loginCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/auth/session")) return Response.json(alice);
    if (String(input).endsWith("/auth/logout")) return pending.promise;
    if (String(input).endsWith("/auth/login")) {
      loginCalls += 1;
      return Response.json(bob);
    }
    return Response.json([]);
  };
  mount();
  await screen.findByTestId("domain");
  let logout!: Promise<void>;
  await act(async () => {
    logout = dashboard.logout();
  });
  assert.equal(screen.queryByTestId("domain"), null);
  assert.ok((screen.getByRole("button", { name: "Signing out..." }) as HTMLButtonElement).disabled);
  await act(async () => {
    await dashboard.login("Bob", "synthetic-password");
  });
  assert.equal(loginCalls, 0);
  await act(async () => {
    pending.resolve(Response.json({ loggedOut: true }));
    await logout;
  });
  await act(async () => {
    await dashboard.login("Bob", "synthetic-password");
  });
  assert.equal(loginCalls, 1);
  assert.equal(dashboard.session?.user?.id, "bob");
});
