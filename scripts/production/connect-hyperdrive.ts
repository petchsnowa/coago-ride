import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { unstable_dev } from "wrangler";
import { bootstrapConfig } from "./bootstrap";
import { cloudflareRequest } from "../remote/config";
import { probeDatabase } from "../database-readiness/probe";
import {
  hyperdriveName,
  selectHyperdrive,
  verifyHyperdrive,
  probeName,
  type HyperdriveConfig,
} from "./hyperdrive-policy";
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
async function summary(value: string) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, value + "\n");
}
async function main() {
  const { origin } = bootstrapConfig({
    ...process.env,
    COAGO_BOOTSTRAP_OPERATION: "check",
  });
  const account = required("CLOUDFLARE_ACCOUNT_ID"),
    token = required("CLOUDFLARE_API_TOKEN");
  if (account !== "ca1d36a602c74e57ebacaf8676da3eeb")
    throw new Error("PRODUCTION_CLOUDFLARE_ACCOUNT_MISMATCH");
  mask(token);
  mask(required("COAGO_PRODUCTION_DATABASE_URL"));
  mask(origin.password);
  const name = probeName(
    required("GITHUB_RUN_ID"),
    required("GITHUB_RUN_ATTEMPT"),
  );
  const client = new pg.Client({
    host: origin.host,
    port: origin.port,
    database: origin.database,
    user: origin.user,
    password: origin.password,
    ssl: { rejectUnauthorized: true },
    options: "-c default_transaction_read_only=on",
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
    if (
      !schema.postgis ||
      schema.appTables !== 8 ||
      schema.migrations !== 7 ||
      expected.length !== 7
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
    console.log(
      "PASS production Direct TLS preflight: schema and all seven migration hashes match",
    );
  } finally {
    await client.end().catch(() => {});
  }
  const api = <T>(path: string, init: RequestInit = {}) =>
    cloudflareRequest<T>(account, token, path, init);
  const configs = await api<HyperdriveConfig[]>("/hyperdrive/configs");
  // Display only this resource's public IDs to support an explicit, pinned retry.
  console.log(
    "PRODUCTION_HYPERDRIVE_MATCHES",
    JSON.stringify(
      configs.filter((c) => c.name === hyperdriveName).map((c) => c.id),
    ),
  );
  let id = selectHyperdrive(
    configs,
    process.env.COAGO_PRODUCTION_HYPERDRIVE_ID ?? "",
  );
  if (!id) {
    const created = await api<HyperdriveConfig>("/hyperdrive/configs", {
      method: "POST",
      body: JSON.stringify({
        name: hyperdriveName,
        origin,
        caching: { disabled: true },
      }),
    });
    if (!/^[a-f\d]{32}$/.test(created.id))
      throw new Error("PRODUCTION_HYPERDRIVE_ID_INVALID");
    id = created.id;
    console.log("PRODUCTION_HYPERDRIVE_CREATED", id);
  }
  const config = await api<HyperdriveConfig>(`/hyperdrive/configs/${id}`);
  verifyHyperdrive(config, origin, id);
  await summary(
    `# Production Hyperdrive connection\n\nHyperdrive ID: \`${id}\`\n\nThe configuration remains for the production app, including if the remote probe fails. Existing resources are never updated or deleted. No DNS/routes/app deployment/migrations in this workflow.`,
  );
  const probeToken = randomBytes(32).toString("hex");
  mask(probeToken);
  const directory = join(required("RUNNER_TEMP"), name);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "wrangler.json");
  await writeFile(
    path,
    JSON.stringify({
      name,
      account_id: account,
      compatibility_date: "2026-07-08",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      vars: {
        ENVIRONMENT: "production-connection-probe",
        PROBE_TOKEN: probeToken,
      },
      hyperdrive: [{ binding: "HYPERDRIVE", id }],
    }),
    { mode: 0o600 },
  );
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  const watchdog = setTimeout(() => {
    console.error("PRODUCTION_REMOTE_PROBE_TIMEOUT");
    process.exit(1);
  }, 180000);
  try {
    worker = await unstable_dev("scripts/production/hyperdrive-worker.ts", {
      config: path,
      accountId: account,
      local: false,
      ip: "127.0.0.1",
      port: 8799,
      logLevel: "error",
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
    assert.equal(
      (await worker.fetch("/")).status,
      404,
      "PRODUCTION_PROBE_AUTH_FAILED",
    );
    let report: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await worker.fetch("/", {
        headers: { Authorization: `Bearer ${probeToken}` },
        signal: AbortSignal.timeout(12000),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.ok) {
        report = body;
        break;
      }
      console.log(
        `PRODUCTION_PROBE_RETRY_${attempt + 1}_HTTP_${response.status}`,
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
    assert(report, "PRODUCTION_REMOTE_PROBE_UNAVAILABLE");
    assert.equal(report.transport, "hyperdrive");
    assert.equal(report.appTables, 8);
    assert.equal(report.migrations, 7);
    assert.equal(report.point, "POINT(100.5018 13.7563)");
    assert.equal(report.srid, 4326);
    assert.equal(typeof report.postgres, "string");
    assert.match(String(report.postgis), /^\d+\.\d+\.\d+/);
    console.log(
      "PRODUCTION_HYPERDRIVE_PASS",
      JSON.stringify({ hyperdriveId: id, ...report }),
    );
    await summary(
      `\nRemote Workers preview → Hyperdrive → production Neon: **PASS**. Auth guard, PostgreSQL/PostGIS, 8 tables/7 migrations and spatial SRID verified with read-only SQL. Set environment variable \`COAGO_PRODUCTION_HYPERDRIVE_ID\` to \`${id}\` for the next step/retries. Real app/LINE login and coago.space are not deployed or tested by this probe.`,
    );
  } finally {
    try {
      await worker?.stop();
    } finally {
      clearTimeout(watchdog);
      await rm(directory, { recursive: true, force: true });
    }
    console.log("PRODUCTION_PREVIEW_STOPPED");
  }
}
main().catch(async (error) => {
  const message = error instanceof Error ? error.message : "";
  const safe = /^[A-Z][A-Z0-9_,]{0,150}$/.test(message)
    ? message
    : "PRODUCTION_CONNECTION_FAILED";
  console.error(safe);
  await summary(
    `\nConnection verification failed: ${safe}. Do not deploy the app or change DNS based on this run.`,
  );
  process.exitCode = 1;
});
