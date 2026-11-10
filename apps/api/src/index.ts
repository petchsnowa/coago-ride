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
