import { describe, expect, it } from "vitest";
import { checkRelease, releaseOrigin } from "../scripts/release/check";

function fixture(change?: (path: string, response: Response) => Response) {
  const calls: { path: string; options?: RequestInit }[] = [];
  const request = (async (input: URL | RequestInfo, options?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, options });
    const json = (body: unknown, status = 200, headers = {}) =>
      Response.json(body, { status, headers });
    let response: Response;
    if (path === "/")
      response = new Response(
        '<title>COAGO</title><script src="/assets/app.js"></script><link href="/assets/app.css">',
        { headers: { "content-type": "text/html" } },
      );
    else if (path.startsWith("/assets/"))
      response = new Response("asset", {
        headers: {
          "content-type": path.endsWith(".js")
            ? "application/javascript"
            : "text/css",
        },
      });
    else if (path === "/health/live")
      response = json({ status: "ok" }, 200, {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "content-security-policy": "frame-ancestors 'none'",
      });
    else if (path === "/health/ready") response = json({ status: "ready" });
    else if (path === "/api/auth/me")
      response = json(
        { user: null, csrfToken: null, loginAvailable: true },
        200,
        { "cache-control": "no-store" },
      );
    else if (path === "/api/discovery/trips/upcoming")
      response = json({ trips: [], nextCursor: null });
    else
      response = json({ error: "unauthorized" }, 401, {
        "cache-control": "no-store",
      });
    return change ? change(path, response) : response;
  }) as typeof fetch;
  return { request, calls };
}
const trip = {
  id: "22222222-2222-4222-8222-222222222222",
  originProvince: "กรุงเทพมหานคร",
  destinationProvince: "เชียงใหม่",
  departureAt: "2099-01-01T00:00:00.000Z",
  seats: 1,
  vehicleModel: "Test car",
  vehicleColor: "White",
  contributionSatang: 30000,
};
describe("read-only release check", () => {
  it("only performs anonymous GETs and does not start login or mutate data", async () => {
    const { request, calls } = fixture();
    const result = await checkRelease("https://app.example", request);
    expect(result).toHaveLength(9);
    expect(result.every((c) => c.passed)).toBe(true);
    for (const { path, options } of calls) {
      expect(options?.method).toBe("GET");
      expect(options?.redirect).toBe("error");
      expect(options?.credentials).toBe("omit");
      expect(options?.body).toBeUndefined();
      expect(new Headers(options?.headers).has("Cookie")).toBe(false);
      expect(path).not.toContain("/line/");
    }
  });
  it.each([
    "http://app.example",
    "https://name:secret@app.example",
    "https://app.example/path",
    "https://app.example?token=secret",
    "https://app.example#fragment",
  ])("rejects non-origin or insecure input %s", (value) => {
    expect(() => releaseOrigin(value)).toThrow();
  });
  it.each([
    ["/health/ready", { status: "unavailable" }, 503, "/health/ready"],
    ["/api/trips", { trips: [] }, 200, "private:/api/trips"],
    [
      "/api/auth/me",
      { user: null, csrfToken: null, loginAvailable: false },
      200,
      "anonymous-auth",
    ],
  ] as const)(
    "reports unavailable/misconfigured endpoints without echoing body",
    async (path, body, status, name) => {
      const { request } = fixture((p, response) =>
        p === path ? Response.json(body, { status }) : response,
      );
      expect(
        (await checkRelease("https://app.example", request)).find(
          (c) => c.name === name,
        )?.passed,
      ).toBe(false);
    },
  );
  it.each([
    { ...trip, ownerId: "private-id" },
    { ...trip, seats: 0 },
    { ...trip, departureAt: "2020-01-01T00:00:00.000Z" },
  ])("fails unsafe, full or expired public trip", async (unsafe) => {
    const { request } = fixture((p, response) =>
      p === "/api/discovery/trips/upcoming"
        ? Response.json({ trips: [unsafe], nextCursor: null })
        : response,
    );
    expect(
      (await checkRelease("https://app.example", request)).find(
        (c) => c.name === "public-trip-projection",
      )?.passed,
    ).toBe(false);
  });
  it("rejects a permissive cross-origin API", async () => {
    const { request } = fixture((p, response) => {
      if (p === "/health/live")
        response.headers.set("access-control-allow-origin", "*");
      return response;
    });
    expect(
      (await checkRelease("https://app.example", request)).find(
        (c) => c.name === "api-security-headers-and-cors",
      )?.passed,
    ).toBe(false);
  });
  it("does not follow asset links to another origin", async () => {
    const { request, calls } = fixture((p, response) =>
      p === "/"
        ? new Response(
            '<title>COAGO</title><script src="https://other.example/code.js"></script>',
            { headers: { "content-type": "text/html" } },
          )
        : response,
    );
    expect((await checkRelease("https://app.example", request))[0].passed).toBe(
      false,
    );
    expect(calls.some((c) => c.path === "/code.js")).toBe(false);
  });
  it("reports network failures as failed checks without leaking errors", async () => {
    const request = (async () => {
      throw new Error("secret-detail");
    }) as typeof fetch;
    const result = await checkRelease("https://app.example", request);
    expect(result.every((c) => !c.passed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-detail");
  });
});
