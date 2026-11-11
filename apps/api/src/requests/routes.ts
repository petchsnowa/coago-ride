import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createRideRequestSchema,
  decideRideRequestSchema,
  rideRequestResponseSchema,
  rideRequestListSchema,
  rideRequestContextSchema,
  tripCursorSchema,
} from "@coago/contracts";
import { databaseUrl, type Bindings } from "../bindings";
import { postgresAuthStore, type AuthStore, type Session } from "../auth/store";
import { lineConfig } from "../auth/line";
import { hash } from "../auth/crypto";
import {
  postgresRideRequestStore,
  RideRequestError,
  type RideRequestStore,
} from "./store";
export type RideRequestDependencies = {
  store: (url: string, enforce?: boolean) => RideRequestStore;
  authStore: (url: string) => AuthStore;
  now: () => Date;
};
export function rideRequestRoutes(
  overrides: Partial<RideRequestDependencies> = {},
) {
  const deps: RideRequestDependencies = {
    store: postgresRideRequestStore,
    authStore: postgresAuthStore,
    now: () => new Date(),
    ...overrides,
  };
  const app = new Hono<{
    Bindings: Bindings;
    Variables: { session: Session };
  }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(c, "__Host-coago_session");
    if (!token || !/^[\da-f]{64}$/.test(token))
      return c.json({ error: "unauthorized" }, 401);
    const session = await deps
      .authStore(databaseUrl(c.env))
      .getSession(await hash(token), deps.now());
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("session", session);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      if (
        c.req.header("Origin") !== lineConfig(c.env).origin ||
        c.req.header("X-CSRF-Token") !== session.csrfToken
      )
        return c.json({ error: "forbidden" }, 403);
      if (
        c.req.header("Content-Type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      )
        return c.json({ error: "json_required" }, 415);
    }
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  for (const kind of ["mine", "incoming"] as const)
    app.get(`/${kind}`, async (c) => {
      let cursor;
      const query = c.req.query();
      try {
        if (Object.keys(query).some((key) => key !== "cursor"))
          throw new Error();
        if (query.cursor !== undefined) {
          const raw = query.cursor;
          if (!raw || raw.length > 300 || !/^[\w-]+$/.test(raw))
            throw new Error();
          cursor = tripCursorSchema.parse(
            JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/"))),
          );
        }
      } catch {
        return c.json({ error: "invalid_cursor" }, 400);
      }
      return c.json(
        rideRequestListSchema.parse(
          await deps
            .store(databaseUrl(c.env), c.env.ENVIRONMENT === "production")
            .list(c.get("session").user.id, kind, cursor),
        ),
      );
    });
  app.get("/for-trip/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_trip_id" }, 400);
    return c.json(
      rideRequestContextSchema.parse(
        await deps
          .store(databaseUrl(c.env), c.env.ENVIRONMENT === "production")
          .context(c.get("session").user.id, id.data, deps.now()),
      ),
    );
  });
  app.post("/", async (c) => {
    const input = createRideRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: "invalid_request" }, 400);
    const result = await deps
      .store(databaseUrl(c.env), c.env.ENVIRONMENT === "production")
      .create(c.get("session").user.id, input.data, deps.now());
    return c.json(
      rideRequestResponseSchema.parse({ request: result.request }),
      result.created ? 201 : 200,
    );
  });
  app.post("/:id/decision", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = decideRideRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
    if (!id.success || !input.success)
      return c.json({ error: "invalid_request" }, 400);
    return c.json(
      rideRequestResponseSchema.parse({
        request: await deps
          .store(databaseUrl(c.env), c.env.ENVIRONMENT === "production")
          .decide(c.get("session").user.id, id.data, input.data, deps.now()),
      }),
    );
  });
  app.post("/:id/cancel", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      body = z
        .object({})
        .strict()
        .safeParse(await c.req.json().catch(() => null));
    if (!id.success || !body.success)
      return c.json({ error: "invalid_request" }, 400);
    return c.json(
      rideRequestResponseSchema.parse({
        request: await deps
          .store(databaseUrl(c.env), c.env.ENVIRONMENT === "production")
          .cancel(c.get("session").user.id, id.data, deps.now()),
      }),
    );
  });
  app.onError((error, c) =>
    error instanceof RideRequestError
      ? c.json(
          { error: error.code },
          ["trip_not_found", "request_not_found"].includes(error.code)
            ? 404
            : 409,
        )
      : c.json({ error: "service_unavailable" }, 503),
  );
  return app;
}
