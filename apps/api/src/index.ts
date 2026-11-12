import { notificationRoutes } from "./notifications/routes";
import { dispatchNotification } from "./notifications/dispatch";
import { wantedRoutes, publicWantedRoutes } from "./community/wanted";
import { journeyRoutes } from "./community/journeys";
import { adminAuthRoutes } from "./admin-auth/routes";
import {
  rideRequestRoutes,
  type RideRequestDependencies,
} from "./requests/routes";
import { membershipRoutes } from "./membership/routes";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { checkDatabase } from "@coago/db";
import { liveSchema, readySchema, errorSchema } from "@coago/contracts";
import { databaseUrl, type Bindings } from "./bindings";
import { authRoutes, type AuthDependencies } from "./auth/routes";
import { adminRoutes, type AdminDependencies } from "./admin/routes";
import {
  rootSubject,
  accessEnforced,
  readSiteSettings,
  isRoot,
} from "./admin/access";
import { postgresAuthStore } from "./auth/store";
import { getCookie } from "hono/cookie";
import { hash } from "./auth/crypto";
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
  adminDependencies: Partial<AdminDependencies> = {},
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
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://access.line.me",
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
      if (
        /^\/api\/(?:trips|ride-requests|admin|membership|wanted|journeys|notifications)(?:\/|$)/.test(
          c.req.path,
        )
      )
        return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  app.get("/api/site", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      return c.json(
        await (adminDependencies.site ?? readSiteSettings)(databaseUrl(c.env)),
      );
    } catch {
      return c.json({ error: "service_unavailable" }, 503);
    }
  });
  app.use("/api/*", async (c, next) => {
    if (
      accessEnforced(c.env) &&
      /^\/api\/(?:trips|ride-requests|discovery)(?:\/|$)/.test(c.req.path)
    ) {
      c.header("Cache-Control", "no-store");
      try {
        const settings = await (adminDependencies.site ?? readSiteSettings)(
          databaseUrl(c.env),
        );
        if (!settings.serviceOpen) {
          const token = getCookie(c, "__Host-coago_session");
          const session =
            token && /^[a-f\d]{64}$/.test(token)
              ? await (authDependencies.store ?? postgresAuthStore)(
                  databaseUrl(c.env),
                ).getSession(await hash(token), new Date())
              : undefined;
          if (
            !session?.rootVerified ||
            !(await (adminDependencies.role ?? isRoot)(
              databaseUrl(c.env),
              session.user.id,
              rootSubject(c.env),
            ))
          )
            return c.json({ error: "service_closed" }, 503);
        }
      } catch {
        return c.json({ error: "service_unavailable" }, 503);
      }
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
  app.route("/api/notifications", notificationRoutes());
  app.route("/api/wanted", wantedRoutes());
  app.route("/api/journeys", journeyRoutes());
  app.route("/api/discovery/wanted", publicWantedRoutes());
  app.route("/api/membership", membershipRoutes());
  app.route("/api/admin-auth", adminAuthRoutes());
  app.route("/api/auth", authRoutes(authDependencies));
  app.route(
    "/api/admin",
    adminRoutes({
      ...adminDependencies,
      ...(authDependencies.store ? { authStore: authDependencies.store } : {}),
    }),
  );
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
const app = createApp();
export default Object.assign(app, {
  async scheduled(_event: unknown, env: Bindings) {
    await dispatchNotification(env);
  },
});
