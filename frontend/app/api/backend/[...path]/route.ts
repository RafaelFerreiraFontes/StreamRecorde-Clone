import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  // No origin means non-browser/curl request - allow
  if (!origin) return true;
  // Origin present but no host - reject
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    // Origin host must exactly match received host
    return parsed.host === host;
  } catch {
    // Malformed origin - reject
    return false;
  }
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const [resource, id, child] = path;
  const readable =
    [
      "creators",
      "watch-targets",
      "streams",
      "recordings",
      "streamer",
      "session",
    ].includes(resource) &&
    (path.length === 1 ||
      (path.length === 2 && !!id) ||
      (path.length === 3 &&
        resource === "creators" &&
        child === "watch-targets"));
  const writable =
    resource === "watch-targets" &&
    ((request.method === "POST" && path.length === 1) ||
      (request.method === "PATCH" && path.length === 2) ||
      (request.method === "DELETE" && path.length === 2));
  if (
    !(request.method === "GET" ? readable : writable) ||
    path.some(
      (segment) => segment === "." || segment === ".." || /[\\/]/.test(segment),
    )
  )
    return Response.json({ message: "Unsupported API route" }, { status: 404 });
  if (
    request.method !== "GET" &&
    request.headers.get("origin") &&
    !isSameOrigin(request)
  )
    return Response.json(
      { message: "Cross-origin mutation rejected" },
      { status: 403 },
    );
  try {
    const base = new URL(process.env.API_BASE_URL || "http://localhost:3000");
    const url = new URL(
      path.map(encodeURIComponent).join("/"),
      base.href.replace(/\/?$/, "/"),
    );
    if (
      resource === "recordings" &&
      request.nextUrl.searchParams.has("watchTargetId")
    )
      url.searchParams.set(
        "watchTargetId",
        request.nextUrl.searchParams.get("watchTargetId")!,
      );
    const response = await fetch(url, {
      method: request.method,
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: ["POST", "PATCH"].includes(request.method) ? await request.text() : undefined,
      signal: AbortSignal.timeout(10000),
    });
    return new Response(
      response.status === 204 ? null : await response.text(),
      {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") || "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        message:
          "NestJS API unavailable. Check API_BASE_URL and the API process.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
