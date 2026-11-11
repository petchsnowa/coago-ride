import {
  rideRequestRoutes,
  type RideRequestDependencies,
} from "./requests/routes";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkDatabase } from "@coago/db";
import { liveSchema, readySchema, errorSchema } from "@coago/contracts";
import { databaseUrl, type Bindings } from "./bindings";
import { authRoutes, type AuthDependencies } from "./auth/routes";
import { tripRoutes, type TripDependencies } from "./trips/routes";
import {
  discoveryRoutes,
  type DiscoveryDependencies,
} from "./discovery/routes";
export type { Bindings } from "./bindings";
export function createApp(
  check: (url: string) => Promise<void> = checkDatabase,
  authDependencies: Partial<AuthDependencies> = {},
  tripDependencies: Partial<TripDependencies> = {},
  discoveryDependencies: Partial<DiscoveryDependencies> = {},
  requestDependencies: Partial<RideRequestDependencies> = {},
) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    if (
      c.env.ENVIRONMENT === "production" &&
      /^[a-f\d]{40}$/.test(c.env.RELEASE_COMMIT ?? "")
    )
      c.header("X-COAGO-Release", c.env.RELEASE_COMMIT!);
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://access.line.me",
    );
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin, c) =>
        (c.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((s: string) => s.trim())
          .includes(origin)
          ? origin
          : undefined,
    }),
  );
  // A workers.dev preview may read public data/health, but must not start login
  // or create sessions/requests before the canonical domain is connected.
  app.use("/api/*", async (c, next) => {
    if (
      c.env.ENVIRONMENT === "production" &&
      new URL(c.req.url).origin !== c.env.APP_ORIGIN
    ) {
      c.header("Cache-Control", "no-store");
      if (c.req.path === "/api/auth/me" && c.req.method === "GET")
        return c.json({ user: null, csrfToken: null, loginAvailable: false });
      if (
        c.req.path.startsWith("/api/auth/") ||
        !["GET", "HEAD"].includes(c.req.method)
      )
        return c.json({ error: "canonical_origin_required" }, 403);
      if (/^\/api\/(?:trips|ride-requests)(?:\/|$)/.test(c.req.path))
        return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  app.get("/health/live", (c) => c.json(liveSchema.parse({ status: "ok" })));
  app.get("/health/ready", async (c) => {
    try {
      await check(databaseUrl(c.env));
      return c.json(readySchema.parse({ status: "ready" }), 200);
    } catch {
      return c.json(readySchema.parse({ status: "unavailable" }), 503);
    }
  });
  app.route("/api/auth", authRoutes(authDependencies));
  app.route(
    "/api/ride-requests",
    rideRequestRoutes({
      ...requestDependencies,
      ...(authDependencies.store ? { authStore: authDependencies.store } : {}),
      ...(authDependencies.now && !requestDependencies.now
        ? { now: authDependencies.now }
        : {}),
    }),
  );
  app.route("/api/discovery/trips", discoveryRoutes(discoveryDependencies));
  app.route(
    "/api/trips",
    tripRoutes({
      ...tripDependencies,
      ...(authDependencies.store ? { authStore: authDependencies.store } : {}),
      ...(authDependencies.now && !tripDependencies.now
        ? { now: authDependencies.now }
        : {}),
    }),
  );
  app.notFound((c) => {
    if (
      c.env.ASSETS &&
      !/^\/(?:api|health)(?:\/|$)/.test(c.req.path) &&
      ["GET", "HEAD"].includes(c.req.method)
    )
      return c.env.ASSETS.fetch(c.req.raw);
    return c.json(errorSchema.parse({ error: "not_found" }), 404);
  });
  app.onError((_error, c) =>
    c.json(errorSchema.parse({ error: "internal_error" }), 500),
  );
  return app;
}
export default createApp();
