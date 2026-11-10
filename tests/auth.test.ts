import { beforeEach, expect, it, vi, type Mock } from "vitest";
import { createApp } from "../apps/api/src/index";
import { hash, challenge } from "../apps/api/src/auth/crypto";
import { exchangeIdentity, type LineIdentity } from "../apps/api/src/auth/line";
import type { AuthStore, Flow, Session } from "../apps/api/src/auth/store";
import type { Bindings } from "../apps/api/src/bindings";
const env: Bindings = {
  ENVIRONMENT: "test",
  DATABASE_URL: "mock-test-db",
  APP_ORIGIN: "https://coago.test",
  LINE_CHANNEL_ID: "123456",
  LINE_CHANNEL_SECRET: "private-channel-secret",
  LINE_CALLBACK_URL: "https://coago.test/api/auth/line/callback",
};
const subject = "U" + "a".repeat(32);
let now: Date,
  flows: Map<string, Flow>,
  sessions: Map<string, Session & { expiresAt: Date }>,
  store: AuthStore,
  identity: Mock<typeof exchangeIdentity>,
  app: ReturnType<typeof createApp>;
beforeEach(() => {
  now = new Date("2026-11-09T00:00:00Z");
  flows = new Map();
  sessions = new Map();
  store = {
    allowStart: vi.fn().mockResolvedValue(true),
    saveFlow: vi.fn(async (flow) => {
      flows.set(flow.idHash, flow);
    }),
    takeFlow: vi.fn(async (id, state, time) => {
      const flow = flows.get(id);
      if (!flow || flow.stateHash !== state || flow.expiresAt <= time) return;
      flows.delete(id);
      return flow;
    }),
    createSession: vi.fn(
      async (_identity: LineIdentity, token, csrfToken, expiresAt) => {
        const user = {
          id: "123e4567-e89b-42d3-a456-426614174000",
          displayName: _identity.displayName,
        };
        sessions.set(token, { user, csrfToken, expiresAt });
        return user;
      },
    ),
    getSession: vi.fn(async (token, time) => {
      const session = sessions.get(token);
      return session && session.expiresAt > time ? session : undefined;
    }),
    deleteSession: vi.fn(async (token) => {
      sessions.delete(token);
    }),
  };
  identity = vi.fn().mockResolvedValue({ subject, displayName: "ผู้ทดสอบ" });
  app = createApp(async () => {}, {
    store: () => store,
    identity,
    now: () => now,
  });
});
function cookie(response: Response, name: string) {
  const value = response.headers
    .get("set-cookie")
    ?.match(new RegExp(`${name}=([^;]+)`))?.[1];
  if (!value) throw new Error("missing cookie");
  return `${name}=${value}`;
}
async function start() {
  const response = await app.request("/api/auth/line/start", {}, env);
  expect(response.status).toBe(302);
  return {
    response,
    flowCookie: cookie(response, "__Host-coago_oauth"),
    url: new URL(response.headers.get("location")!),
  };
}
async function callback(
  state: string,
  cookieValue: string,
  extra = "code=valid-code",
) {
  return app.request(
    `/api/auth/line/callback?state=${state}&${extra}`,
    { headers: { Cookie: cookieValue } },
    env,
  );
}
it("creates a server-side PKCE/nonce/state flow with secure host-only cookie", async () => {
  const { response, url, flowCookie } = await start();
  const flow = [...flows.values()][0];
  expect(url.origin).toBe("https://access.line.me");
  expect(url.searchParams.get("scope")).toBe("openid profile");
  expect(url.searchParams.get("redirect_uri")).toBe(env.LINE_CALLBACK_URL);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBe(
    await challenge(flow.verifier),
  );
  expect(url.searchParams.get("nonce")).toBe(flow.nonce);
  expect(flow.idHash).toBe(await hash(flowCookie.split("=")[1]));
  expect(flow.stateHash).toBe(await hash(url.searchParams.get("state")!));
  expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
  expect(response.headers.get("set-cookie")).toMatch(/SameSite=Lax/);
  expect(response.headers.get("set-cookie")).not.toContain("Domain=");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("implements the standard PKCE SHA256 vector", async () =>
  expect(await challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  ));
it("creates a session only after provider verification; rejects callback replay", async () => {
  const { url, flowCookie } = await start();
  const state = url.searchParams.get("state")!;
  const response = await callback(state, flowCookie);
  expect(response.headers.get("location")).toBe("/");
  const sessionCookie = cookie(response, "__Host-coago_session");
  const raw = sessionCookie.split("=")[1];
  expect(sessions.has(await hash(raw))).toBe(true);
  expect(sessions.has(raw)).toBe(false);
  const me = await app.request(
    "/api/auth/me",
    { headers: { Cookie: sessionCookie } },
    env,
  );
  const data = await me.json();
  expect(data.user.displayName).toBe("ผู้ทดสอบ");
  expect(data).not.toHaveProperty("subject");
  expect(JSON.stringify(data)).not.toContain(raw);
  const replay = await callback(state, flowCookie);
  expect(replay.headers.get("location")).toBe("/?auth=failed");
  expect(identity).toHaveBeenCalledTimes(1);
  expect(store.createSession).toHaveBeenCalledTimes(1);
});
it.each([
  "missing-cookie",
  "wrong-state",
  "expired",
  "duplicate-state",
  "denied",
])("rejects %s without creating session", async (reason) => {
  const { url, flowCookie } = await start();
  let state = url.searchParams.get("state")!,
    cookies = flowCookie,
    extra = "code=valid-code";
  if (reason === "missing-cookie") cookies = "";
  if (reason === "wrong-state") state = "0".repeat(64);
  if (reason === "expired") now = new Date(now.getTime() + 660000);
  if (reason === "duplicate-state") extra += `&state=${state}`;
  if (reason === "denied") extra = "error=access_denied";
  expect((await callback(state, cookies, extra)).headers.get("location")).toBe(
    "/?auth=failed",
  );
  expect(identity).not.toHaveBeenCalled();
  expect(store.createSession).not.toHaveBeenCalled();
});
it("does not return provider errors or secrets to the browser", async () => {
  const { url, flowCookie } = await start();
  identity.mockRejectedValue(
    new Error("provider returned private-channel-secret"),
  );
  const response = await callback(url.searchParams.get("state")!, flowCookie);
  expect(response.headers.get("location")).toBe("/?auth=failed");
  expect(await response.text()).not.toContain("private-channel-secret");
  expect(store.createSession).not.toHaveBeenCalled();
});
it("requires exact Origin and CSRF token for logout and revokes the stored session", async () => {
  const { url, flowCookie } = await start();
  const response = await callback(url.searchParams.get("state")!, flowCookie);
  const sessionCookie = cookie(response, "__Host-coago_session");
  const me = await (
    await app.request(
      "/api/auth/me",
      { headers: { Cookie: sessionCookie } },
      env,
    )
  ).json();
  for (const [origin, csrf] of [
    ["https://evil.test", me.csrfToken],
    ["https://coago.test", "wrong"],
  ]) {
    const rejected = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: origin,
          "X-CSRF-Token": csrf,
        },
      },
      env,
    );
    expect(rejected.status).toBe(403);
  }
  const logout = await app.request(
    "/api/auth/logout",
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "https://coago.test",
        "X-CSRF-Token": me.csrfToken,
      },
    },
    env,
  );
  expect(logout.status).toBe(204);
  expect(
    await (
      await app.request(
        "/api/auth/me",
        { headers: { Cookie: sessionCookie } },
        env,
      )
    ).json(),
  ).toEqual({ user: null, csrfToken: null, loginAvailable: true });
});
it("expired session is anonymous", async () => {
  const { url, flowCookie } = await start();
  const response = await callback(url.searchParams.get("state")!, flowCookie);
  const sessionCookie = cookie(response, "__Host-coago_session");
  now = new Date(now.getTime() + 86400001);
  const me = await app.request(
    "/api/auth/me",
    { headers: { Cookie: sessionCookie } },
    env,
  );
  expect((await me.json()).user).toBeNull();
  expect(me.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("rate limits login starts before writing another flow", async () => {
  vi.mocked(store.allowStart).mockResolvedValue(false);
  const response = await app.request("/api/auth/line/start", {}, env);
  expect(response.status).toBe(429);
  expect(store.saveFlow).not.toHaveBeenCalled();
});
it("unconfigured auth does not break liveness or pretend login is available", async () => {
  expect((await app.request("/health/live", {}, {})).status).toBe(200);
  expect(
    (await (await app.request("/api/auth/me", {}, {})).json()).loginAvailable,
  ).toBe(false);
  expect((await app.request("/api/auth/line/start", {}, {})).status).toBe(503);
});
const config = {
  channelId: "123456",
  secret: "private-channel-secret",
  callback: "https://coago.test/api/auth/line/callback",
  origin: "https://coago.test",
};
function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://access.line.me",
    sub: subject,
    aud: config.channelId,
    iat: 1794182390,
    exp: 1794186000,
    nonce: "expected-nonce",
    name: "ชื่อจาก LINE",
    ...overrides,
  };
}
function lineFetch(body: Record<string, unknown>) {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "signed-id-token" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(body)));
}
it("exchanges code with PKCE then verifies ID token server-side", async () => {
  const request = lineFetch(claims());
  const result = await exchangeIdentity(
    config,
    "code",
    "verifier",
    "expected-nonce",
    now,
    request,
  );
  expect(result).toEqual({ subject, displayName: "ชื่อจาก LINE" });
  expect(request.mock.calls[0][0]).toBe(
    "https://api.line.me/oauth2/v2.1/token",
  );
  expect(request.mock.calls[0][1].body.get("code_verifier")).toBe("verifier");
  expect(request.mock.calls[1][0]).toBe(
    "https://api.line.me/oauth2/v2.1/verify",
  );
  expect(request.mock.calls[1][1].body.get("nonce")).toBe("expected-nonce");
});
it.each([
  { nonce: "wrong" },
  { aud: "other-channel" },
  { iss: "https://evil.test" },
  { exp: 0 },
  { iat: 9999999999 },
  { sub: "" },
])("rejects invalid verified claim %j", async (bad) => {
  await expect(
    exchangeIdentity(
      config,
      "code",
      "verifier",
      "expected-nonce",
      now,
      lineFetch(claims(bad)),
    ),
  ).rejects.toThrow();
});
it("does not trust a successful token exchange without ID token verification", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "unverified" })),
    )
    .mockResolvedValueOnce(new Response("{}", { status: 400 }));
  await expect(
    exchangeIdentity(
      config,
      "code",
      "verifier",
      "expected-nonce",
      now,
      request,
    ),
  ).rejects.toThrow("LINE_TOKEN_VERIFICATION_FAILED");
});
