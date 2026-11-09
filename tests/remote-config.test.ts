import { expect, it, vi } from "vitest";
import {
  parseTestOrigin,
  resourceName,
  cloudflareRequest,
} from "../scripts/remote/config";
it("parses Neon direct origin without passing URL options to Cloudflare", () => {
  expect(
    parseTestOrigin(
      "postgresql://user:p%40ss@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    ),
  ).toEqual({
    scheme: "postgres",
    host: "ep-example.us-east-2.aws.neon.tech",
    port: 5432,
    database: "neondb",
    user: "user",
    password: "p@ss",
  });
});
it.each([
  "postgresql://u:p@localhost/db?sslmode=require",
  "postgresql://u:p@ep-example-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
  "postgresql://u:p@ep-example.neon.tech/db",
  "https://example.com",
])("rejects invalid test origin %s", (url) =>
  expect(() => parseTestOrigin(url)).toThrow(),
);
it("requires run-specific names", () => {
  expect(resourceName("123", "1")).toBe("coago-hd-test-123-1");
  expect(() => resourceName("production", "")).toThrow();
});
it("does not include provider messages or credentials in errors", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "password=secret" }],
      }),
      { status: 403 },
    ),
  );
  await expect(
    cloudflareRequest(
      "a".repeat(32),
      "token",
      "/hyperdrive/configs",
      {},
      request,
    ),
  ).rejects.toThrow("CLOUDFLARE_HTTP_403_CODES_10000");
});
it("does not send token to unexpected resource", async () => {
  const request = vi.fn();
  await expect(
    cloudflareRequest("a".repeat(32), "token", "/workers/scripts", {}, request),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it("remote probe rejects unauthenticated requests before database access", async () => {
  const { default: probe } =
    await import("../scripts/remote/hyperdrive-worker");
  const response = await probe.fetch(new Request("https://probe.test/"), {
    PROBE_TOKEN: "private-test-token",
  });
  expect(response.status).toBe(404);
});
it("authenticated probe requires an actual Hyperdrive binding", async () => {
  const { default: probe } =
    await import("../scripts/remote/hyperdrive-worker");
  const response = await probe.fetch(
    new Request("https://probe.test/", {
      headers: { Authorization: "Bearer private-test-token" },
    }),
    { PROBE_TOKEN: "private-test-token" },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "HYPERDRIVE_BINDING_MISSING",
  });
});
