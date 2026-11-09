import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { cloudflareRequest, parseTestOrigin, resourceName } from "./config";
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function mask(value: string) {
  console.log(
    `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
}
const account = required("CLOUDFLARE_ACCOUNT_ID");
const token = required("CLOUDFLARE_API_TOKEN");
const name = resourceName(
  required("GITHUB_RUN_ID"),
  required("GITHUB_RUN_ATTEMPT"),
);
const api = <T>(path: string, init: RequestInit = {}) =>
  cloudflareRequest<T>(account, token, path, init);
type Config = { id: string; name: string };
async function summary(text: string) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}
async function cleanup() {
  // Exact per-run name only; never remove existing application resources.
  const configs = await api<Config[]>("/hyperdrive/configs");
  const matches = configs.filter((c) => c.name === name);
  for (const config of matches) {
    if (!/^[a-f\d]{32}$/.test(config.id))
      throw new Error("INVALID_HYPERDRIVE_ID");
    await api(`/hyperdrive/configs/${config.id}`, { method: "DELETE" });
  }
  const remaining = await api<Config[]>("/hyperdrive/configs");
  assert(
    !remaining.some((c) => c.name === name),
    "Hyperdrive cleanup incomplete",
  );
  console.log(
    `CLEANUP_OK: ${matches.length} temporary Hyperdrive configurations removed`,
  );
  await summary(
    "Temporary Hyperdrive cleanup: **verified** (no matching configuration remains).",
  );
}
async function run() {
  const dbUrl = required("COAGO_TEST_DATABASE_URL");
  mask(token);
  mask(dbUrl);
  const origin = parseTestOrigin(dbUrl);
  mask(origin.password);
  if ((await api<Config[]>("/hyperdrive/configs")).some((c) => c.name === name))
    throw new Error("TEST_RESOURCE_ALREADY_EXISTS");
  await summary(
    "# Remote Hyperdrive test\nMode: Cloudflare remote preview → Hyperdrive → Neon test database. Read-only SQL; no production routes or deployments.",
  );
  const created = await api<Config>("/hyperdrive/configs", {
    method: "POST",
    body: JSON.stringify({ name, origin, caching: { disabled: true } }),
  });
  assert(/^[a-f\d]{32}$/.test(created.id), "INVALID_HYPERDRIVE_ID");
  console.log("HYPERDRIVE_CREATED");
  const probeToken = randomBytes(32).toString("hex");
  mask(probeToken);
  const directory = join(required("RUNNER_TEMP"), "coago-remote-test");
  await mkdir(directory, { recursive: true });
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name,
      account_id: account,
      compatibility_date: "2026-07-08",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      vars: { ENVIRONMENT: "remote-test", PROBE_TOKEN: probeToken },
      hyperdrive: [{ binding: "HYPERDRIVE", id: created.id }],
    }),
    { mode: 0o600 },
  );
  const watchdog = setTimeout(() => {
    console.error("REMOTE_PREVIEW_TIMEOUT");
    process.exit(1);
  }, 180000);
  let worker: Awaited<ReturnType<typeof unstable_dev>> | undefined;
  try {
    worker = await unstable_dev("scripts/remote/hyperdrive-worker.ts", {
      config: configPath,
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
    const unauthenticated = await worker.fetch("/");
    assert.equal(unauthenticated.status, 404);
    let result: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await worker.fetch("/", {
        headers: { Authorization: `Bearer ${probeToken}` },
        signal: AbortSignal.timeout(12000),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.ok) {
        result = body;
        break;
      }
      console.log(`REMOTE_PROBE_RETRY_${attempt + 1}_HTTP_${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    assert(result, "REMOTE_PROBE_UNAVAILABLE");
    assert.equal(result.transport, "hyperdrive");
    assert.equal(result.readiness, 200);
    assert.equal(result.point, "POINT(100.5018 13.7563)");
    assert.equal(result.srid, 4326);
    assert.equal(typeof result.postgres, "string");
    assert.match(String(result.postgis), /^\d+\.\d+\.\d+/);
    console.log("REMOTE_HYPERDRIVE_PASS", JSON.stringify(result));
    await summary(
      `Remote query: **PASS**\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
    );
  } finally {
    try {
      await worker?.stop();
    } finally {
      clearTimeout(watchdog);
    }
  }
}
try {
  if (process.argv[2] === "cleanup") await cleanup();
  else if (process.argv[2] === "run") await run();
  else throw new Error("EXPECTED_RUN_OR_CLEANUP");
} catch (error) {
  // Only known local error codes; never emit raw provider error bodies or input values.
  const message = error instanceof Error ? error.message : "";
  const safe = /^[A-Z][A-Z0-9_,: -]{0,150}$/.test(message)
    ? message
    : "REMOTE_TEST_FAILED_SEE_REDACTED_WRANGLER_ERROR";
  console.error(safe);
  await summary(`Result: **FAILED** (${safe}).`);
  process.exitCode = 1;
}
