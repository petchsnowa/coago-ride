import { currentAppTableCount, currentMigrationCount } from "@coago/db";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Miniflare } from "miniflare";
import { testDatabaseUrl } from "./database";
const watchdog = setTimeout(() => {
  console.error("LOCAL_PRODUCTION_PROBE_TIMEOUT");
  process.exit(1);
}, 45000);
const dir = await mkdtemp(join(tmpdir(), "coago-prod-probe-test-"));
let runtime: Miniflare | undefined;
try {
  const config = join(dir, "wrangler.json"),
    out = join(dir, "dist");
  await writeFile(
    config,
    JSON.stringify({
      name: "coago-prod-probe-local",
      main: resolve("scripts/production/hyperdrive-worker.ts"),
      compatibility_date: "2026-07-08",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  await new Promise<void>((done, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--config",
        config,
        "--outdir",
        out,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error("PROBE_BUILD_FAILED")),
    );
  });
  runtime = new Miniflare({
    modules: true,
    scriptPath: join(out, "hyperdrive-worker.js"),
    modulesRoot: out,
    compatibilityDate: "2026-07-08",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      PROBE_TOKEN: "local-fixture-only",
      HYPERDRIVE: { connectionString: testDatabaseUrl() },
    },
  });
  assert.equal((await runtime.dispatchFetch("http://localhost/")).status, 404);
  const response = await runtime.dispatchFetch("http://localhost/", {
    headers: { Authorization: "Bearer local-fixture-only" },
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.appTables, currentAppTableCount);
  assert.equal(data.migrations, currentMigrationCount);
  assert.equal(data.srid, 4326);
  assert.equal(data.point, "POINT(100.5018 13.7563)");
  console.log(
    "PASS production connection probe in local Workers runtime: real PostgreSQL/PostGIS, read-only metadata and spatial queries; local JSON binding is not proof of remote Hyperdrive",
  );
} finally {
  await runtime?.dispose();
  await rm(dir, { recursive: true, force: true });
  clearTimeout(watchdog);
}
