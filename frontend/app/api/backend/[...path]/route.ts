import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const [resource, id, child] = path;
  const authRoute = resource === "auth" && path.length === 2;
  const authAllowed =
    authRoute &&
    ((request.method === "GET" && id === "session") ||
      (request.method === "POST" && ["login", "logout"].includes(id)));
  const readable =
    ["creators", "watch-targets", "streams", "recordings", "streamer", "session"].includes(
      resource,
    ) &&
    (path.length === 1 ||
      (path.length === 2 && !!id) ||
      (path.length === 3 &&
        ((resource === "creators" && child === "watch-targets") ||
          (resource === "recordings" && child === "location"))));
  const writable =
    resource === "watch-targets" &&
    ((request.method === "POST" && path.length === 1) ||
      (request.method === "PATCH" && path.length === 2) ||
      (request.method === "DELETE" && path.length === 2));
  if (
    !(authAllowed || (request.method === "GET" ? readable : writable)) ||
    path.some((segment) => segment === "." || segment === ".." || /[\\/]/.test(segment))
  )
    return Response.json({ message: "Unsupported API route" }, { status: 404 });
  if (request.method !== "GET" && request.headers.get("origin") && !isSameOrigin(request))
    return Response.json({ message: "Cross-origin mutation rejected" }, { status: 403 });
  try {
    const base = new URL(process.env.API_BASE_URL || "http://localhost:3000");
    const url = new URL(path.map(encodeURIComponent).join("/"), base.href.replace(/\/?$/, "/"));
    if (resource === "recordings" && request.nextUrl.searchParams.has("watchTargetId"))
      url.searchParams.set("watchTargetId", request.nextUrl.searchParams.get("watchTargetId")!);
    if (resource === "recordings" && id === "filesystem" && path.length === 2) {
      url.searchParams.set("path", request.nextUrl.searchParams.get("path") ?? "");
    }
    const headers = new Headers({ "Content-Type": "application/json" });
    const sessionCookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie.startsWith("sr_session="));
    if (sessionCookies.length === 1 && /^sr_session=[A-Za-z0-9_-]{43}$/.test(sessionCookies[0]))
      headers.set("Cookie", sessionCookies[0]);
    for (const name of ["origin", "referer"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const response = await fetch(url, {
      method: request.method,
      cache: "no-store",
      redirect: "error",
      headers,
      body: ["POST", "PATCH"].includes(request.method) ? await request.text() : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    if (authRoute && ["login", "logout"].includes(id)) {
      for (const cookie of response.headers.getSetCookie())
        responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(response.status === 204 ? null : await response.text(), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        message: "NestJS API unavailable. Check API_BASE_URL and the API process.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
