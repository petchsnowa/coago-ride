import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { testDatabaseUrl } from "./database";
const databaseUrl = testDatabaseUrl();
const timeout = setTimeout(() => {
  console.error("Workers test exceeded 30 seconds");
  process.exit(1);
}, 30000);
const runtime = new Miniflare({
  modules: true,
  scriptPath: "apps/api/dist/index.js",
  compatibilityDate: "2026-07-08",
  compatibilityFlags: ["nodejs_compat"],
  bindings: { ENVIRONMENT: "test", DATABASE_URL: databaseUrl },
});
try {
  const live = await runtime.dispatchFetch("http://localhost/health/live");
  assert.equal(live.status, 200);
  const ready = await runtime.dispatchFetch("http://localhost/health/ready");
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready" });
  await runtime.setOptions({
    modules: true,
    scriptPath: "apps/api/dist/index.js",
    compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ENVIRONMENT: "test",
      DATABASE_URL: "postgresql://coago_test:coago_test@127.0.0.1:1/coago_test",
    },
  });
  const failed = await runtime.dispatchFetch("http://localhost/health/ready");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { status: "unavailable" });
  console.log(
    "PASS local Workers runtime → pg TCP → PostgreSQL/PostGIS; unavailable database returns 503",
  );
} finally {
  try {
    await runtime.dispose();
  } finally {
    clearTimeout(timeout);
  }
}
