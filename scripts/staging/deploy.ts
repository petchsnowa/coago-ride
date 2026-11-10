import assert from "node:assert/strict";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { parseTestOrigin } from "../remote/config";
const workerName = "coago-line-test";
const owner = "petchsnowa/coago-ride:line-login-test";
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
const account = required("CLOUDFLARE_ACCOUNT_ID"),
  token = required("CLOUDFLARE_API_TOKEN");
async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (
    !/^[a-f\d]{32}$/.test(account) ||
    !/^\/(?:workers\/subdomain|workers\/scripts\/coago-line-test(?:\/settings)?|hyperdrive\/configs(?:\/[a-f\d]{32})?)$/.test(
      path,
    )
  )
    throw new Error("STAGING_RESOURCE_SCOPE_INVALID");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const payload = (await response.json()) as {
    success: boolean;
    result: T;
    errors?: { code: number }[];
  };
  if (!response.ok || !payload.success)
    throw new Error(
      `CLOUDFLARE_HTTP_${response.status}_CODES_${(payload.errors ?? [])
        .map((e) => Number(e.code))
        .filter(Number.isFinite)
        .join(",")}`,
    );
  return payload.result;
}
type Settings = {
  bindings: { name: string; type: string; text?: string; id?: string }[];
};
type Hyperdrive = { id: string; name: string };
async function wrangler(config: string, secrets: string) {
  await new Promise<void>((done, reject) => {
    const process = spawn(
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
      { stdio: "inherit", env: globalThis.process.env },
    );
    process.once("error", () => reject(new Error("WRANGLER_START_FAILED")));
    process.once("exit", (code) =>
      code === 0 ? done() : reject(new Error("WRANGLER_DEPLOY_FAILED")),
    );
  });
}
async function main() {
  const channel = required("LINE_CHANNEL_ID"),
    secret = required("LINE_CHANNEL_SECRET"),
    database = required("COAGO_TEST_DATABASE_URL");
  mask(token);
  mask(secret);
  mask(database);
  if (channel !== "2012503801")
    throw new Error("EXPECTED_COAGO_TEST_LINE_CHANNEL");
  const origin = parseTestOrigin(database);
  mask(origin.password);
  const { subdomain } = await cf<{ subdomain: string }>("/workers/subdomain");
  if (!/^[a-z\d-]+$/i.test(subdomain))
    throw new Error("WORKERS_SUBDOMAIN_UNAVAILABLE");
  const appURL = `https://${workerName}.${subdomain}.workers.dev`,
    callback = `${appURL}/api/auth/line/callback`;
  let existing: Settings | undefined;
  try {
    existing = await cf<Settings>(`/workers/scripts/${workerName}/settings`);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("CLOUDFLARE_HTTP_404_"))
      throw e;
  }
  if (
    existing &&
    !existing.bindings.some(
      (b) => b.name === "COAGO_STAGE_OWNER" && b.text === owner,
    )
  )
    throw new Error("STAGING_WORKER_NAME_ALREADY_IN_USE");
  const matches = (await cf<Hyperdrive[]>("/hyperdrive/configs")).filter(
    (c) => c.name === workerName,
  );
  if (
    matches.length > 1 ||
    (matches.length === 1 &&
      !existing?.bindings.some(
        (b) => b.name === "HYPERDRIVE" && b.id === matches[0].id,
      ))
  )
    throw new Error("STAGING_HYPERDRIVE_NAME_ALREADY_IN_USE");
  let hyperdrive: Hyperdrive | undefined;
  let created = false,
    uploadStarted = false;
  try {
    if (matches[0]) {
      hyperdrive = matches[0];
      await cf(`/hyperdrive/configs/${hyperdrive.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: workerName,
          origin,
          caching: { disabled: true },
        }),
      });
    } else {
      hyperdrive = await cf<Hyperdrive>("/hyperdrive/configs", {
        method: "POST",
        body: JSON.stringify({
          name: workerName,
          origin,
          caching: { disabled: true },
        }),
      });
      created = true;
    }
    assert(/^[a-f\d]{32}$/.test(hyperdrive.id), "HYPERDRIVE_ID_INVALID");
    const direct = new URL(database);
    direct.searchParams.delete("sslmode");
    direct.searchParams.delete("channel_binding");
    const client = new pg.Client({
      connectionString: direct.href,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
    });
    try {
      await client.connect();
      await migrate(drizzle(client), {
        migrationsFolder: "packages/db/migrations",
      });
      console.log("STAGING_TEST_DATABASE_MIGRATED");
    } finally {
      await client.end();
    }
    const directory = join(required("RUNNER_TEMP"), "coago-line-staging");
    await mkdir(directory, { recursive: true });
    const config = join(directory, "wrangler.json"),
      secretFile = join(directory, "secrets.json");
    await writeFile(
      config,
      JSON.stringify({
        name: workerName,
        account_id: account,
        main: resolve("apps/api/src/index.ts"),
        compatibility_date: "2026-07-08",
        compatibility_flags: ["nodejs_compat"],
        workers_dev: true,
        observability: { enabled: false },
        assets: {
          directory: resolve("apps/web/dist"),
          binding: "ASSETS",
          not_found_handling: "single-page-application",
          run_worker_first: true,
        },
        vars: {
          ENVIRONMENT: "staging",
          COAGO_STAGE_OWNER: owner,
          APP_ORIGIN: appURL,
          LINE_CALLBACK_URL: callback,
          LINE_CHANNEL_ID: channel,
          ALLOWED_ORIGINS: "",
        },
        hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdrive.id }],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      secretFile,
      JSON.stringify({ LINE_CHANNEL_SECRET: secret }),
      { mode: 0o600 },
    );
    uploadStarted = true;
    await wrangler(config, secretFile);
    let healthy = false;
    for (let i = 0; i < 8; i++) {
      try {
        const response = await fetch(`${appURL}/health/ready`, {
          signal: AbortSignal.timeout(10000),
        });
        healthy =
          response.ok &&
          ((await response.json()) as { status: string }).status === "ready";
      } catch {
        /* Wait for edge propagation. */
      }
      if (healthy) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    assert(healthy, "STAGING_READINESS_FAILED");
    console.log("STAGING_READINESS_OK");
    const me = await fetch(`${appURL}/api/auth/me`, {
      signal: AbortSignal.timeout(10000),
    });
    assert(me.ok, `STAGING_ME_HTTP_${me.status}`);
    const anonymous = await me.json();
    console.log("STAGING_ANONYMOUS_STATE", JSON.stringify(anonymous));
    assert.deepEqual(anonymous, {
      user: null,
      csrfToken: null,
      loginAvailable: true,
    });
    const start = await fetch(`${appURL}/api/auth/line/start`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(start.status, 302, `STAGING_START_HTTP_${start.status}`);
    const location = new URL(start.headers.get("location")!);
    assert.equal(
      location.origin,
      "https://access.line.me",
      "STAGING_LINE_ORIGIN_INVALID",
    );
    assert.equal(
      location.searchParams.get("client_id"),
      channel,
      "STAGING_LINE_CHANNEL_INVALID",
    );
    assert.equal(
      location.searchParams.get("redirect_uri"),
      callback,
      "STAGING_LINE_CALLBACK_INVALID",
    );
    assert.equal(
      location.searchParams.get("code_challenge_method"),
      "S256",
      "STAGING_PKCE_INVALID",
    );
    assert(
      start.headers.get("set-cookie")?.includes("HttpOnly"),
      "STAGING_COOKIE_INVALID",
    );
    const page = await fetch(appURL, { signal: AbortSignal.timeout(10000) });
    assert(page.ok, `STAGING_ASSETS_HTTP_${page.status}`);
    assert(
      (await page.text()).includes("COAGO"),
      "STAGING_ASSETS_CONTENT_INVALID",
    );
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `app_url=${appURL}\n`);
    console.log(`STAGING_READY ${appURL}`);
    console.log(`LINE_CALLBACK_URL ${callback}`);
    console.log(
      "PASS HTTPS, assets, anonymous session, LINE redirect configuration and Hyperdrive readiness",
    );
    console.log(
      "MANUAL_CHECK: use the COAGO Test callback and sign in to try this version; real LINE interaction is not automated",
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `# COAGO LINE Login staging\n\n- App: ${appURL}\n- Callback URL: ${callback}\n- Test channel: ${channel}\n- Checks: HTTPS, assets, anonymous session, LINE redirect/PKCE, database readiness passed.\n- Real LINE authorization/callback: requires manual tester interaction; see verification docs for prior owner confirmation.\n\nTest Worker and Hyperdrive remain for manual testing. No production DNS/routes changed. Neon coago-test auto-deletes after 7 days.\n`,
      );
  } catch (error) {
    if (!existing && uploadStarted) {
      try {
        await cf(`/workers/scripts/${workerName}`, { method: "DELETE" });
        console.log("FAILED_STAGING_WORKER_REMOVED");
      } catch {
        console.error("FAILED_STAGING_WORKER_CLEANUP_REQUIRES_REVIEW");
      }
    }
    if (created && hyperdrive) {
      try {
        await cf(`/hyperdrive/configs/${hyperdrive.id}`, { method: "DELETE" });
        console.log("FAILED_STAGING_HYPERDRIVE_REMOVED");
      } catch {
        console.error("FAILED_STAGING_HYPERDRIVE_CLEANUP_REQUIRES_REVIEW");
      }
    }
    throw error;
  }
}
try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^[A-Z][A-Z0-9_,]{0,150}$/.test(message) ? message : "STAGING_SETUP_FAILED",
  );
  process.exitCode = 1;
}
