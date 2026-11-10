import { isDeepStrictEqual } from "node:util";
import { publicTripSummarySchema } from "@coago/contracts";

export function releaseOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("EXPECTED_HTTPS_ORIGIN");
  return url.origin;
}
export type ReleaseCheck = { name: string; passed: boolean };

// Anonymous GETs only: never start an OAuth flow, create sessions or write records.
export async function checkRelease(
  value: string,
  request: typeof fetch = fetch,
) {
  const origin = releaseOrigin(value),
    checks: ReleaseCheck[] = [];
  async function check(name: string, work: () => Promise<void>) {
    try {
      await work();
      checks.push({ name, passed: true });
    } catch {
      checks.push({ name, passed: false });
    }
  }
  function require(condition: unknown): asserts condition {
    if (!condition) throw new Error("CHECK_FAILED");
  }
  async function get(path: string, headers?: HeadersInit) {
    return request(new URL(path, origin), {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers,
    });
  }
  await check("homepage-and-assets", async () => {
    const response = await get("/");
    require(
      response.status === 200 &&
        response.headers.get("content-type")?.includes("text/html"),
    );
    const html = await response.text();
    require(html.includes("COAGO"));
    const paths = [
      ...html.matchAll(
        /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
      ),
    ].map((m) => m[1]);
    require(paths.some((p) => new URL(p, origin).pathname.endsWith(".js")));
    for (const path of paths) {
      const url = new URL(path, origin);
      require(url.origin === origin);
      const asset = await get(url.pathname + url.search);
      require(asset.status === 200);
      const mime = asset.headers.get("content-type") ?? "";
      require(
        url.pathname.endsWith(".js")
          ? /(?:javascript|ecmascript)/.test(mime)
          : mime.includes("text/css"),
      );
      await asset.body?.cancel();
    }
  });
  for (const [path, status] of [
    ["/health/live", "ok"],
    ["/health/ready", "ready"],
  ] as const)
    await check(path, async () => {
      const response = await get(path);
      require(response.status === 200);
      require(isDeepStrictEqual(await response.json(), { status }));
    });
  await check("anonymous-auth", async () => {
    const response = await get("/api/auth/me");
    require(
      response.status === 200 &&
        response.headers.get("cache-control")?.includes("no-store"),
    );
    require(
      isDeepStrictEqual(await response.json(), {
        user: null,
        csrfToken: null,
        loginAvailable: true,
      }),
    );
  });
  for (const path of [
    "/api/trips",
    "/api/ride-requests/mine",
    "/api/ride-requests/incoming",
  ])
    await check(`private:${path}`, async () => {
      const response = await get(path);
      require(
        response.status === 401 &&
          response.headers.get("cache-control")?.includes("no-store"),
      );
      require(
        isDeepStrictEqual(await response.json(), { error: "unauthorized" }),
      );
    });
  await check("public-trip-projection", async () => {
    const response = await get("/api/discovery/trips/upcoming");
    require(response.status === 200);
    const data: unknown = await response.json();
    require(data !== null && typeof data === "object" && !Array.isArray(data));
    require(
      isDeepStrictEqual(Object.keys(data).sort(), ["nextCursor", "trips"]),
    );
    const raw = data as { trips: unknown; nextCursor: unknown };
    require(
      raw.nextCursor === null &&
        Array.isArray(raw.trips) &&
        raw.trips.length <= 6,
    );
    const trips = raw.trips.map((t) =>
      publicTripSummarySchema.strict().parse(t),
    );
    require(
      trips.every((t) => t.seats > 0 && Date.parse(t.departureAt) > Date.now()),
    );
    require(
      trips.every(
        (t, i) => i === 0 || t.departureAt >= trips[i - 1].departureAt,
      ),
    );
  });
  await check("api-security-headers-and-cors", async () => {
    const response = await get("/health/live", {
      Origin: "https://untrusted.invalid",
    });
    require(response.status === 200);
    require(response.headers.get("x-content-type-options") === "nosniff");
    require(response.headers.get("x-frame-options") === "DENY");
    require(response.headers.get("referrer-policy") === "no-referrer");
    require(
      response.headers
        .get("content-security-policy")
        ?.includes("frame-ancestors 'none'"),
    );
    require(!response.headers.get("access-control-allow-origin"));
    await response.body?.cancel();
  });
  return checks;
}
