import { currentAppTableCount, currentMigrationCount } from "@coago/db";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { probeDatabase } from "../database-readiness/probe";
import { safeDatabaseFailure } from "../database-readiness/config";
import { siteSettingsSchema } from "@coago/contracts";
import { verifyHyperdrive, type HyperdriveConfig } from "./hyperdrive-policy";
import {
  productionWorkerSettings,
  productionWorker,
  productionOwner,
  productionHyperdriveId,
  productionOrigin,
} from "./worker-config";
function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`MISSING_${name}`);
  return v;
}
function mask(v: string) {
  console.log(
    `::add-mask::${v.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
}
async function main() {
  const settings = productionWorkerSettings(process.env),
    account = required("CLOUDFLARE_ACCOUNT_ID"),
    token = required("CLOUDFLARE_API_TOKEN"),
    secret = required("LINE_CHANNEL_SECRET");
  mask(token);
  mask(secret);
  mask(required("ROOT_ADMIN_EMAIL"));
  mask(required("MEMBER_DATA_KEY"));
  if (process.env.ORS_API_KEY) mask(process.env.ORS_API_KEY);
  mask(required("COAGO_PRODUCTION_DATABASE_URL"));
  mask(settings.origin.password);
  async function cf<T>(path: string): Promise<T> {
    if (
      !/^\/(?:workers\/subdomain|workers\/scripts\/coago-production\/settings|hyperdrive\/configs\/2e437b2ff82c46b99963380be05335f0)$/.test(
        path,
      )
    )
      throw new Error("PRODUCTION_RESOURCE_SCOPE_INVALID");
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    const body = (await response.json()) as {
      success: boolean;
      result: T;
      errors?: { code: number }[];
    };
    if (!response.ok || !body.success)
      throw new Error(
        `CLOUDFLARE_HTTP_${response.status}_CODES_${
          (body.errors ?? [])
            .map((e) => Number(e.code))
            .filter(Number.isFinite)
            .join("_") || "UNKNOWN"
        }`,
      );
    return body.result;
  }
  verifyHyperdrive(
    await cf<HyperdriveConfig>(`/hyperdrive/configs/${productionHyperdriveId}`),
    settings.origin,
    productionHyperdriveId,
  );
  const client = new pg.Client({
    host: settings.origin.host,
    port: settings.origin.port,
    database: settings.origin.database,
    user: settings.origin.user,
    password: settings.origin.password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    statement_timeout: 5000,
    query_timeout: 7000,
  });
  try {
    await client.connect();
    const schema = await probeDatabase(client),
      expected = readMigrationFiles({
        migrationsFolder: "packages/db/migrations",
      });
    const siteBefore = (
      await client.query(
        "SELECT service_open,registrations_open FROM site_settings WHERE id='site'",
      )
    ).rows[0];
    if (!siteBefore || siteBefore.service_open || siteBefore.registrations_open)
      throw new Error("PRODUCTION_SERVICE_MUST_BE_CLOSED");
    if (
      schema.appTables !== currentAppTableCount ||
      schema.migrations !== currentMigrationCount ||
      !schema.postgis ||
      expected.length !== currentMigrationCount
    )
      throw new Error("PRODUCTION_SCHEMA_NOT_READY");
    const rows = (
      await client.query<{ hash: string; created_at: string }>(
        "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
      )
    ).rows;
    if (
      rows.length !== expected.length ||
      rows.some(
        (r, i) =>
          r.hash !== expected[i].hash ||
          Number(r.created_at) !== expected[i].folderMillis,
      )
    )
      throw new Error("PRODUCTION_MIGRATION_HISTORY_MISMATCH");
  } finally {
    await client.end().catch(() => {});
  }
  type WorkerSettings = {
    bindings: { name: string; text?: string; id?: string }[];
  };
  let existing: WorkerSettings | undefined;
  try {
    existing = await cf<WorkerSettings>(
      `/workers/scripts/${productionWorker}/settings`,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("CLOUDFLARE_HTTP_404_")
    )
      throw error;
  }
  if (
    existing &&
    (!existing.bindings.some(
      (b) => b.name === "COAGO_PRODUCTION_OWNER" && b.text === productionOwner,
    ) ||
      !existing.bindings.some(
        (b) => b.name === "HYPERDRIVE" && b.id === productionHyperdriveId,
      ))
  )
    throw new Error("PRODUCTION_WORKER_ALREADY_IN_USE");
  // This preparation workflow must not overwrite an app already serving the canonical domain.
  const canonical = await fetch(`${productionOrigin}/health/live`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const operation = process.env.COAGO_WORKER_OPERATION ?? "prepare";
  if (!["prepare", "maintenance_update"].includes(operation))
    throw new Error("PRODUCTION_OPERATION_REQUIRED");
  if (operation === "maintenance_update" && !existing)
    throw new Error("PRODUCTION_EXISTING_WORKER_REQUIRED");
  if (
    canonical.headers.has("X-COAGO-Release") &&
    operation !== "maintenance_update"
  )
    throw new Error("PRODUCTION_CANONICAL_ALREADY_LIVE");
  await canonical.body?.cancel();
  const { subdomain } = await cf<{ subdomain: string }>("/workers/subdomain");
  if (subdomain !== "akkarapatchara")
    throw new Error("PRODUCTION_SUBDOMAIN_MISMATCH");
  const preview = `https://${productionWorker}.${subdomain}.workers.dev`,
    directory = join(required("RUNNER_TEMP"), "coago-production-worker");
  await mkdir(directory, { recursive: true });
  const config = join(directory, "wrangler.json"),
    secrets = join(directory, "secrets.json");
  try {
    await writeFile(
      config,
      JSON.stringify({
        name: productionWorker,
        account_id: account,
        main: resolve("apps/api/src/index.ts"),
        compatibility_date: "2026-07-08",
        compatibility_flags: ["nodejs_compat"],
        workers_dev: true,
        routes: [],
        observability: { enabled: false },
        assets: {
          directory: resolve("apps/web/dist"),
          binding: "ASSETS",
          not_found_handling: "single-page-application",
          run_worker_first: ["/api", "/api/*", "/health", "/health/*"],
        },
        vars: settings.vars,
        ...(process.env.COAGO_PRIVATE_DOCUMENTS_BUCKET
          ? {
              r2_buckets: [
                {
                  binding: "PRIVATE_DOCUMENTS",
                  bucket_name: process.env.COAGO_PRIVATE_DOCUMENTS_BUCKET,
                },
              ],
            }
          : {}),
        hyperdrive: [{ binding: "HYPERDRIVE", id: productionHyperdriveId }],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      secrets,
      JSON.stringify({
        LINE_CHANNEL_SECRET: secret,
        ROOT_ADMIN_EMAIL: required("ROOT_ADMIN_EMAIL"),
        MEMBER_DATA_KEY: required("MEMBER_DATA_KEY"),
        ...(process.env.ORS_API_KEY
          ? { ORS_API_KEY: process.env.ORS_API_KEY }
          : {}),
      }),
      {
        mode: 0o600,
      },
    );
    await new Promise<void>((done, reject) => {
      const child = spawn(
        "pnpm",
        [
          "exec",
          "wrangler",
          "deploy",
          "--config",
          config,
          "--secrets-file",
          secrets,
        ],
        { stdio: "inherit", env: process.env },
      );
      child.once("error", () =>
        reject(new Error("PRODUCTION_WRANGLER_START_FAILED")),
      );
      child.once("exit", (code) =>
        code === 0
          ? done()
          : reject(new Error("PRODUCTION_WORKER_UPLOAD_FAILED")),
      );
    });
    let ready = false;
    for (let i = 0; i < 8; i++) {
      try {
        const response = await fetch(`${preview}/health/ready`, {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        ready =
          response.status === 200 &&
          response.headers.get("X-COAGO-Release") ===
            settings.vars.RELEASE_COMMIT &&
          ((await response.json()) as { status: string }).status === "ready";
      } catch {
        /* edge propagation / cold start */
      }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    assert(ready, "PRODUCTION_WORKER_READINESS_FAILED");
    const me = await fetch(`${preview}/api/auth/me`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), {
      user: null,
      csrfToken: null,
      loginAvailable: false,
    });
    for (const path of ["/api/auth/line/start", "/api/auth/line/callback"]) {
      const blocked = await fetch(`${preview}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(blocked.status, 403, "PRODUCTION_PREVIEW_AUTH_NOT_BLOCKED");
      await blocked.body?.cancel();
    }
    const trips = await fetch(`${preview}/api/trips`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(trips.status, 401);
    await trips.body?.cancel();
    const page = await fetch(preview, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(page.status, 200);
    assert((await page.text()).includes("COAGO"));
    const publicList = await fetch(`${preview}/api/discovery/trips/upcoming`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const publicSite = await fetch(`${preview}/api/site`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(publicSite.status, 200);
    const policy = siteSettingsSchema.parse(await publicSite.json());
    assert.equal(
      policy.serviceOpen,
      false,
      "PRODUCTION_SERVICE_MUST_BE_CLOSED",
    );
    assert.equal(
      policy.registrationsOpen,
      false,
      "PRODUCTION_REGISTRATION_MUST_BE_CLOSED",
    );
    assert.equal(publicList.status, 503);
    await publicList.body?.cancel();
    console.log(
      "PRODUCTION_WORKER_PREPARED",
      JSON.stringify({
        url: preview,
        canonical: productionOrigin,
        commit: settings.vars.RELEASE_COMMIT,
        hyperdriveId: productionHyperdriveId,
        channelId: settings.vars.LINE_CHANNEL_ID,
      }),
    );
    console.log(
      "PASS production Worker assets/readiness, anonymous/private guards and preview login blocking; no DNS/routes or database writes/migrations",
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `# Production Worker prepared\n\n- Preview: ${preview}\n- Canonical: ${productionOrigin}\n- Commit: ${settings.vars.RELEASE_COMMIT}\n- Hyperdrive: ${productionHyperdriveId}\n- LINE channel: ${settings.vars.LINE_CHANNEL_ID}\n\nReadiness/assets/site flags/private401 passed; public trip access correctly returns503 while service is closed. Login/callback are blocked on preview before any session/flow writes. DNS/LINE Console not changed. LINE secret pairing and real login still require canonical-domain manual verification after authorized cutover. Production observability remains disabled pending a reviewed log/privacy configuration.\n`,
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_]{1,150}$/.test(message)
      ? message
      : safeDatabaseFailure(error).startsWith("DATABASE_ERROR_")
        ? safeDatabaseFailure(error)
        : "PRODUCTION_WORKER_PREPARE_FAILED",
  );
  process.exitCode = 1;
});
