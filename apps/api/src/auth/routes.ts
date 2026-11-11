import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { authStateSchema } from "@coago/contracts";
import { databaseUrl, type Bindings } from "../bindings";
import { randomToken, hash, challenge, clientHash } from "./crypto";
import { lineConfig, exchangeIdentity } from "./line";
import { postgresAuthStore, type AuthStore } from "./store";
import { rootSubject, accessEnforced } from "../admin/access";
export type AuthDependencies = {
  store: (url: string) => AuthStore;
  identity: typeof exchangeIdentity;
  now: () => Date;
};
const flowCookie = "__Host-coago_oauth";
const sessionCookie = "__Host-coago_session";
const cookie = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};
const validToken = (value: string | undefined): value is string =>
  !!value && /^[\da-f]{64}$/.test(value);
export function authRoutes(overrides: Partial<AuthDependencies> = {}) {
  const deps: AuthDependencies = {
    store: postgresAuthStore,
    identity: exchangeIdentity,
    now: () => new Date(),
    ...overrides,
  };
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.get("/line/start", async (c) => {
    let config;
    try {
      config = lineConfig(c.env);
    } catch {
      return c.json({ error: "login_unavailable" }, 503);
    }
    const store = deps.store(databaseUrl(c.env));
    const now = deps.now();
    const key = await clientHash(
      config.secret,
      c.req.header("cf-connecting-ip") ?? "local",
    );
    if (!(await store.allowStart(key, now))) {
      c.header("Retry-After", "600");
      return c.json({ error: "try_again_later" }, 429);
    }
    const id = randomToken(),
      state = randomToken(),
      nonce = randomToken(),
      verifier = randomToken();
    await store.saveFlow({
      idHash: await hash(id),
      stateHash: await hash(state),
      nonce,
      verifier,
      expiresAt: new Date(now.getTime() + 600000),
    });
    setCookie(c, flowCookie, id, { ...cookie, maxAge: 600 });
    const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.channelId,
      redirect_uri: config.callback,
      scope: "openid profile",
      state,
      nonce,
      code_challenge: await challenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return c.redirect(url.href);
  });
  app.get("/line/callback", async (c) => {
    const id = getCookie(c, flowCookie);
    deleteCookie(c, flowCookie, cookie);
    try {
      const config = lineConfig(c.env);
      const params = new URL(c.req.url).searchParams;
      const state = params.get("state");
      if (
        !validToken(id) ||
        !validToken(state ?? undefined) ||
        params.getAll("state").length !== 1
      )
        throw new Error("INVALID_STATE");
      const store = deps.store(databaseUrl(c.env)),
        now = deps.now();
      const flow = await store.takeFlow(
        await hash(id),
        await hash(state!),
        now,
      );
      if (!flow || params.has("error")) throw new Error("FLOW_UNAVAILABLE");
      const code = params.get("code");
      if (!code || code.length > 2048 || params.getAll("code").length !== 1)
        throw new Error("CODE_INVALID");
      const identity = await deps.identity(
        config,
        code,
        flow.verifier,
        flow.nonce,
        now,
      );
      const token = randomToken(),
        csrfToken = randomToken();
      await store.createSession(
        identity,
        await hash(token),
        csrfToken,
        new Date(now.getTime() + 86400000),
        now,
        {
          rootSubject: rootSubject(c.env),
          enforceAccess: accessEnforced(c.env),
        },
      );
      const old = getCookie(c, sessionCookie);
      if (validToken(old)) await store.deleteSession(await hash(old));
      setCookie(c, sessionCookie, token, { ...cookie, maxAge: 86400 });
      return c.redirect("/");
    } catch {
      return c.redirect("/?auth=failed");
    }
  });
  app.get("/me", async (c) => {
    let available = true;
    try {
      lineConfig(c.env);
    } catch {
      available = false;
    }
    const token = getCookie(c, sessionCookie);
    if (!available || !validToken(token))
      return c.json(
        authStateSchema.parse({
          user: null,
          csrfToken: null,
          loginAvailable: available,
        }),
      );
    const session = await deps
      .store(databaseUrl(c.env))
      .getSession(await hash(token), deps.now());
    if (!session) {
      deleteCookie(c, sessionCookie, cookie);
      return c.json(
        authStateSchema.parse({
          user: null,
          csrfToken: null,
          loginAvailable: true,
        }),
      );
    }
    return c.json(
      authStateSchema.parse({
        user: session.user,
        csrfToken: session.csrfToken,
        loginAvailable: true,
      }),
    );
  });
  app.post("/logout", async (c) => {
    let config;
    try {
      config = lineConfig(c.env);
    } catch {
      return c.json({ error: "login_unavailable" }, 503);
    }
    if (c.req.header("Origin") !== config.origin)
      return c.json({ error: "forbidden" }, 403);
    const token = getCookie(c, sessionCookie);
    if (validToken(token)) {
      const store = deps.store(databaseUrl(c.env)),
        tokenHash = await hash(token),
        session = await store.getSession(tokenHash, deps.now());
      if (session && c.req.header("X-CSRF-Token") !== session.csrfToken)
        return c.json({ error: "forbidden" }, 403);
      await store.deleteSession(tokenHash);
    }
    deleteCookie(c, sessionCookie, cookie);
    return c.body(null, 204);
  });
  return app;
}
