import assert from "node:assert/strict";
import pg from "pg";
import { Miniflare } from "miniflare";
import { testDatabaseUrl } from "./database";
const database = testDatabaseUrl(),
  client = new pg.Client({ connectionString: database });
const watchdog = setTimeout(() => {
  console.error("PRODUCTION_WORKER_TEST_TIMEOUT");
  process.exit(1);
}, 45000);
const runtime = new Miniflare({
  modules: true,
  scriptPath: "apps/api/dist/index.js",
  compatibilityDate: "2026-07-08",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://coago.space",
    LINE_CALLBACK_URL: "https://coago.space/api/auth/line/callback",
    LINE_CHANNEL_ID: "2009685358",
    LINE_CHANNEL_SECRET: "fixture-only",
    RELEASE_COMMIT: "a".repeat(40),
    HYPERDRIVE: { connectionString: database },
  },
});
try {
  await client.connect();
  const before = (
    await client.query("SELECT count(*)::int AS n FROM oauth_flows")
  ).rows[0].n;
  for (const path of ["/api/auth/line/start", "/api/auth/line/callback"])
    assert.equal(
      (await runtime.dispatchFetch(`https://preview.workers.dev${path}`))
        .status,
      403,
    );
  assert.equal(
    (
      await runtime.dispatchFetch("https://preview.workers.dev/api/trips", {
        method: "POST",
        headers: { Origin: "https://coago.space" },
      })
    ).status,
    403,
  );
  const me = await runtime.dispatchFetch(
    "https://preview.workers.dev/api/auth/me",
  );
  assert.deepEqual(await me.json(), {
    user: null,
    csrfToken: null,
    loginAvailable: false,
  });
  const canonical = await runtime.dispatchFetch(
    "https://coago.space/api/auth/me",
  );
  assert.deepEqual(await canonical.json(), {
    user: null,
    csrfToken: null,
    loginAvailable: true,
  });
  const ready = await runtime.dispatchFetch(
    "https://preview.workers.dev/health/ready",
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("X-COAGO-Release"), "a".repeat(40));
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM oauth_flows")).rows[0]
      .n,
    before,
  );
  console.log(
    "PASS production app in local Workers runtime: preview login/write blocks, canonical anonymous auth, release header and real DB readiness; OAuth flows unchanged, no real LINE exchange",
  );
} finally {
  await runtime.dispose();
  await client.end().catch(() => {});
  clearTimeout(watchdog);
}
