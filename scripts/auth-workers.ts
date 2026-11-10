import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Miniflare } from "miniflare";
import {
  Response as RuntimeResponse,
  Request as RuntimeRequest,
} from "miniflare";
import { withDatabase } from "@coago/db";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  subject = "U" + randomBytes(16).toString("hex");
const runtime = new Miniflare({
  modules: true,
  scriptPath: "apps/api/dist/index.js",
  compatibilityDate: "2026-07-08",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ENVIRONMENT: "test",
    DATABASE_URL: url,
    APP_ORIGIN: "https://coago.test",
    LINE_CALLBACK_URL: "https://coago.test/api/auth/line/callback",
    LINE_CHANNEL_ID: "123456",
    LINE_CHANNEL_SECRET: "mock-only",
  },
  outboundService: async (request: RuntimeRequest) => {
    const params = new URLSearchParams(await request.text());
    if (request.url === "https://api.line.me/oauth2/v2.1/token") {
      assert.equal(params.get("client_secret"), "mock-only");
      assert.equal(
        params.get("redirect_uri"),
        "https://coago.test/api/auth/line/callback",
      );
      assert.equal(params.get("code_verifier")?.length, 64);
      return RuntimeResponse.json({ id_token: "mock-id-token" });
    }
    if (request.url === "https://api.line.me/oauth2/v2.1/verify") {
      assert.equal(params.get("id_token"), "mock-id-token");
      const now = Math.floor(Date.now() / 1000);
      return RuntimeResponse.json({
        iss: "https://access.line.me",
        aud: "123456",
        sub: subject,
        iat: now - 1,
        exp: now + 3600,
        nonce: params.get("nonce"),
        name: "Runtime test user",
      });
    }
    return new RuntimeResponse("Unexpected external request", { status: 500 });
  },
});
const watchdog = setTimeout(() => {
  console.error("AUTH_WORKERS_TIMEOUT");
  process.exit(1);
}, 30000);
function cookie(
  response: { headers: { get(name: string): string | null } },
  name: string,
) {
  const value = response.headers
    .get("set-cookie")
    ?.match(new RegExp(`${name}=([^;]+)`))?.[1];
  assert(value);
  return `${name}=${value}`;
}
try {
  const start = await runtime.dispatchFetch(
    "https://coago.test/api/auth/line/start",
    { redirect: "manual" },
  );
  assert.equal(start.status, 302);
  const target = new URL(start.headers.get("location")!);
  const flowCookie = cookie(start, "__Host-coago_oauth");
  const callback = await runtime.dispatchFetch(
    `https://coago.test/api/auth/line/callback?code=mocked-code&state=${target.searchParams.get("state")}`,
    { headers: { Cookie: flowCookie }, redirect: "manual" },
  );
  assert.equal(callback.headers.get("location"), "/");
  const sessionCookie = cookie(callback, "__Host-coago_session");
  const me = await runtime.dispatchFetch("https://coago.test/api/auth/me", {
    headers: { Cookie: sessionCookie },
  });
  const data = (await me.json()) as {
    user: { displayName: string };
    csrfToken: string;
  };
  assert.equal(data.user.displayName, "Runtime test user");
  const logout = await runtime.dispatchFetch(
    "https://coago.test/api/auth/logout",
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "https://coago.test",
        "X-CSRF-Token": data.csrfToken,
      },
    },
  );
  assert.equal(logout.status, 204);
  const after = await runtime.dispatchFetch("https://coago.test/api/auth/me", {
    headers: { Cookie: sessionCookie },
  });
  assert.deepEqual(await after.json(), {
    user: null,
    csrfToken: null,
    loginAvailable: true,
  });
  console.log(
    "PASS Workers auth runtime with real PostgreSQL and mocked LINE token/verification endpoints",
  );
} finally {
  try {
    await runtime.dispose();
    await withDatabase(url, async (_db, client) => {
      await client.query(
        "DELETE FROM users WHERE id IN (SELECT user_id FROM external_identities WHERE provider=$1 AND subject=$2)",
        ["line", subject],
      );
    });
  } finally {
    clearTimeout(watchdog);
  }
}
