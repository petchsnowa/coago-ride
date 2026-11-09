import { describe, it, expect, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import { liveSchema, readySchema } from "@coago/contracts";
describe("health contracts and API", () => {
  it("rejects malformed payloads", () => {
    expect(readySchema.safeParse({ status: "ok" }).success).toBe(false);
    expect(liveSchema.safeParse({ status: "ok", secret: "oops" }).success).toBe(
      false,
    );
  });
  it("liveness does not use database", async () => {
    const check = vi.fn();
    const r = await createApp(check).request("/health/live", {}, {});
    expect(r.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });
  it("readiness fails without configuration", async () => {
    expect((await createApp().request("/health/ready", {}, {})).status).toBe(
      503,
    );
  });
  it("checks database when configured", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const r = await createApp(check).request(
      "/health/ready",
      {},
      { ENVIRONMENT: "test", DATABASE_URL: "test" },
    );
    expect(r.status).toBe(200);
    expect(check).toHaveBeenCalledWith("test");
  });
  it.each(["connection failure", "extension missing", "timeout"])(
    "redacts %s",
    async (message) => {
      const r = await createApp(async () => {
        throw new Error(message + " secret");
      }).request(
        "/health/ready",
        {},
        { ENVIRONMENT: "test", DATABASE_URL: "test" },
      );
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ status: "unavailable" });
    },
  );
  it("refuses direct URL outside local/test", async () => {
    const check = vi.fn();
    expect(
      (
        await createApp(check).request(
          "/health/ready",
          {},
          { ENVIRONMENT: "production", DATABASE_URL: "test" },
        )
      ).status,
    ).toBe(503);
    expect(check).not.toHaveBeenCalled();
  });
  it("returns generic 404", async () => {
    const r = await createApp().request("/unknown", {}, {});
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
  it("CORS only allows listed origins", async () => {
    const app = createApp();
    for (const origin of ["https://allowed.test", "https://blocked.test"]) {
      const r = await app.request(
        "/health/live",
        { headers: { Origin: origin } },
        { ALLOWED_ORIGINS: "https://allowed.test" },
      );
      expect(r.headers.get("access-control-allow-origin")).toBe(
        origin.includes("allowed") ? "https://allowed.test" : null,
      );
    }
  });
});

it("returns sanitized 500 for unexpected handler errors", async () => {
  const app = createApp();
  app.get("/unexpected", () => {
    throw new Error("secret credential");
  });
  const r = await app.request("/unexpected", {}, {});
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ error: "internal_error" });
});
it("prefers Hyperdrive binding", async () => {
  const check = vi.fn().mockResolvedValue(undefined);
  await createApp(check).request(
    "/health/ready",
    {},
    {
      ENVIRONMENT: "production",
      HYPERDRIVE: { connectionString: "hyperdrive" },
    },
  );
  expect(check).toHaveBeenCalledWith("hyperdrive");
});

it("serves static assets while preserving API and health 404s", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("<html>COAGO</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
  const app = createApp();
  expect((await app.request("/", {}, { ASSETS: { fetch } })).status).toBe(200);
  for (const path of ["/api", "/api/unknown", "/health/unknown"])
    expect((await app.request(path, {}, { ASSETS: { fetch } })).status).toBe(
      404,
    );
  expect(fetch).toHaveBeenCalledTimes(1);
});
