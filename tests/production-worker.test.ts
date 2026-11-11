import { expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/index";
import {
  productionWorkerSettings,
  productionHyperdriveId,
  productionChannelId,
} from "../scripts/production/worker-config";
import { productionHost } from "../scripts/production/bootstrap";
const env = {
  COAGO_DATABASE_TARGET: "production",
  COAGO_PROJECT_CONFIRMATION: "coago-production",
  COAGO_PRODUCTION_DATABASE_URL: `postgresql://fixture:fixture-only@${productionHost}/neondb?sslmode=require`,
  COAGO_PRODUCTION_DATABASE_HOST: productionHost,
  COAGO_PRODUCTION_DATABASE_NAME: "neondb",
  COAGO_PRODUCTION_HYPERDRIVE_ID: productionHyperdriveId,
  COAGO_TEST_DATABASE_URL:
    "postgresql://fixture:fixture-only@ep-test.neon.tech/neondb?sslmode=require",
  CLOUDFLARE_ACCOUNT_ID: "ca1d36a602c74e57ebacaf8676da3eeb",
  ROOT_ADMIN_LINE_SUBJECT: "U" + "a".repeat(32),
  LINE_CHANNEL_ID: productionChannelId,
  LINE_CHANNEL_SECRET: "fixture-only",
  GITHUB_SHA: "a".repeat(40),
};
it("pins production account, Hyperdrive, LINE channel and canonical callback", () => {
  expect(productionWorkerSettings(env).vars.LINE_CALLBACK_URL).toBe(
    "https://coago.space/api/auth/line/callback",
  );
});
it.each([
  { LINE_CHANNEL_ID: "2012503801" },
  { LINE_CHANNEL_SECRET: "" },
  { COAGO_PRODUCTION_HYPERDRIVE_ID: "b".repeat(32) },
  { CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) },
  { GITHUB_SHA: "main" },
])("rejects wrong channel/resources/release before upload", (changes) => {
  expect(() => productionWorkerSettings({ ...env, ...changes })).toThrow();
});
const bindings = {
  ENVIRONMENT: "production",
  APP_ORIGIN: "https://coago.space",
  LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
  LINE_CHANNEL_ID: productionChannelId,
  LINE_CHANNEL_SECRET: "fixture-only",
  RELEASE_COMMIT: "a".repeat(40),
};
it("does not authenticate a preview request even with a cookie", async () => {
  const store = vi.fn();
  const r = await createApp(undefined, { store }).request(
    "https://coago-production.akkarapatchara.workers.dev/api/auth/me",
    { headers: { Cookie: `__Host-coago_session=${"a".repeat(64)}` } },
    bindings,
  );
  expect(await r.json()).toEqual({
    user: null,
    csrfToken: null,
    loginAvailable: false,
  });
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(store).not.toHaveBeenCalled();
});
it.each([
  ["/api/auth/line/start", "GET"],
  ["/api/auth/line/callback", "GET"],
  ["/api/auth/logout", "POST"],
  ["/api/trips", "POST"],
  ["/api/ride-requests", "POST"],
  ["/api/ride-requests/fixture/decision", "POST"],
])(
  "blocks preview login and writes before any store access despite forged canonical Origin",
  async (path, method) => {
    const store = vi.fn();
    const r = await createApp(undefined, { store }).request(
      `https://preview.workers.dev${path}`,
      { method, headers: { Origin: "https://coago.space" } },
      bindings,
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "canonical_origin_required" });
    expect(store).not.toHaveBeenCalled();
  },
);
it("allows the canonical-domain anonymous auth contract and publishes the deployed release", async () => {
  const r = await createApp().request(
    "https://coago.space/api/auth/me",
    {},
    bindings,
  );
  expect(await r.json()).toEqual({
    user: null,
    csrfToken: null,
    loginAvailable: true,
  });
  expect(r.headers.get("X-COAGO-Release")).toBe("a".repeat(40));
});
it("keeps preview liveness and unauthenticated private API reads available for verification", async () => {
  const app = createApp();
  expect(
    (await app.request("https://preview.workers.dev/health/live", {}, bindings))
      .status,
  ).toBe(200);
  expect(
    (await app.request("https://preview.workers.dev/api/trips", {}, bindings))
      .status,
  ).toBe(401);
});
it("does not resolve private preview sessions even with a valid-format session cookie", async () => {
  const store = vi.fn();
  const response = await createApp(undefined, { store }).request(
    "https://preview.workers.dev/api/ride-requests/mine",
    { headers: { Cookie: `__Host-coago_session=${"a".repeat(64)}` } },
    bindings,
  );
  expect(response.status).toBe(401);
  expect(store).not.toHaveBeenCalled();
});
