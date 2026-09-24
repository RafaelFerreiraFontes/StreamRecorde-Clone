import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLDialogElement: { configurable: true, value: dom.window.HTMLDialogElement },
  Event: { configurable: true, value: dom.window.Event },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
});
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

const { cleanup, fireEvent, render, screen, waitFor } =
  await import("@testing-library/react");
const { RecordingBrowser } = await import("../components/recording-browser");
const { DashboardProvider } = await import("../components/provider");
const { default: WatchTargets, WatchTargetEnabledSwitch } =
  await import("../app/watch-targets/page");

const target = {
  id: "target-1",
  creator_id: "creator-1",
  channel_name: "Channel",
  platform: "twitch" as const,
  url: "https://example.test/channel",
  quality: "best",
  enabled: true,
  state: "idle" as const,
  recording_subdir: "existing/folder",
};

afterEach(() => {
  cleanup();
});

test("enabled switch sends its boolean PATCH body, disables optimistically, reconciles, and rolls back on error", async () => {
  let resolveRequest!: (value: Response) => void;
  const request = new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  });
  const originalFetch = globalThis.fetch;
  const errors: string[] = [];
  let refreshes = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/backend/watch-targets/target-1");
    assert.deepEqual(JSON.parse(String(init?.body)), { enabled: false });
    return request;
  };
  try {
    render(
      <WatchTargetEnabledSwitch
        target={target}
        pending={false}
        afterMutation={async () => {
          refreshes += 1;
        }}
        onError={(error) => errors.push(error)}
      />,
    );
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    assert.equal(toggle.getAttribute("aria-busy"), "true");
    assert.equal((toggle as HTMLButtonElement).disabled, true);
    resolveRequest(Response.json(target));
    await waitFor(() => assert.equal(refreshes, 1));
    await waitFor(() => assert.equal(toggle.getAttribute("aria-busy"), "false"));
    assert.deepEqual(errors, [""]);

    globalThis.fetch = async () => Response.json({ message: "nope" }, { status: 500 });
    fireEvent.click(toggle);
    await waitFor(() => assert.match(errors.at(-1) ?? "", /HTTP 500/));
    assert.equal(toggle.getAttribute("aria-checked"), "true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("folder picker initializes an edit path, navigates relative paths, selects, and restores focus after Escape", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const selected: string[] = [];
  let closed = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url), "http://localhost").searchParams.get("path") ?? "";
    calls.push(path);
    if (path === "existing/folder") {
      return Response.json({ path, entries: [{ name: "nested", path: "existing/folder/nested", kind: "directory" }] });
    }
    if (path === "existing/folder/nested") return Response.json({ path, entries: [] });
    return Response.json({ path, entries: [] });
  };
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  try {
    const view = render(
      <RecordingBrowser
        initialPath="existing/folder"
        onSelect={(path) => selected.push(path)}
        onClose={() => {
          closed += 1;
          view.unmount();
        }}
      />,
    );
    await screen.findByText("nested/");
    assert.deepEqual(calls, ["existing/folder"]);
    fireEvent.click(screen.getByText("nested/"));
    await screen.findByText("No subdirectories.");
    fireEvent.click(screen.getByRole("button", { name: "Select current directory" }));
    assert.deepEqual(selected, ["existing/folder/nested"]);
    assert.equal(closed, 1);

    const escapeView = render(<RecordingBrowser onClose={() => escapeView.unmount()} />);
    await screen.findByText("Current directory:");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    await waitFor(() => assert.equal(document.activeElement, opener));
  } finally {
    globalThis.fetch = originalFetch;
    opener.remove();
  }
});

test("folder picker supports root breadcrumbs, loading, empty, retryable errors, and recording location states", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url), "http://localhost").pathname;
    if (pathname.endsWith("/location")) return Response.json({ status: "file_not_found", file: "gone.mp4" });
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return Response.json({ path: "", entries: [] });
  };
  try {
    render(<RecordingBrowser onClose={() => {}} onSelect={() => {}} />);
    assert.equal(screen.getByRole("status").textContent, "Loading folders...");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No subdirectories.");
    assert.equal(screen.getByRole("button", { name: "Recordings root" }).tagName, "BUTTON");
    cleanup();

    render(<RecordingBrowser recordingId="missing" onClose={() => {}} />);
    await screen.findByText("File not found - gone.mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("watch target edit keeps manual entry and saves picker selections through the existing PATCH route", async () => {
  const originalFetch = globalThis.fetch;
  const patches: unknown[] = [];
  globalThis.fetch = async (url, init) => {
    const pathname = new URL(String(url), "http://localhost").pathname;
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return Response.json(target);
    }
    if (pathname.endsWith("/filesystem")) {
      return Response.json({ path: "existing/folder", entries: [] });
    }
    if (pathname.endsWith("/watch-targets")) return Response.json([target]);
    if (pathname.endsWith("/creators")) return Response.json([{ id: "creator-1", display_name: "Creator" }]);
    return Response.json([]);
  };
  try {
    render(<DashboardProvider><WatchTargets /></DashboardProvider>);
    await screen.findByRole("switch", { name: /Enabled for Channel/ });
    fireEvent.click(screen.getByRole("button", { name: "Edit recording folder" }));
    const input = screen.getByRole("textbox", { name: "Recording folder" });
    assert.equal((input as HTMLInputElement).value, "existing/folder");
    fireEvent.change(input, { target: { value: "manual/path" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => assert.deepEqual(patches, [{ recording_subdir: "manual/path" }]));

    const editButton = await screen.findByRole("button", { name: "Edit recording folder" });
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole("button", { name: "Browse recording folders" }));
    await screen.findByText("Current directory:");
    fireEvent.click(screen.getByRole("button", { name: "Select current directory" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => assert.deepEqual(patches.at(-1), { recording_subdir: "existing/folder" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});