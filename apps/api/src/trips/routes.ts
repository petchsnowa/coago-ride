import { MembershipError } from "../membership/eligibility";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import {
  createTripSchema,
  updateTripSchema,
  cancelTripSchema,
  tripResponseSchema,
  tripListSchema,
  tripCursorSchema,
} from "@coago/contracts";
import { z } from "zod";
import { databaseUrl, type Bindings } from "../bindings";
import { postgresAuthStore, type AuthStore, type Session } from "../auth/store";
import { lineConfig } from "../auth/line";
import { hash } from "../auth/crypto";
import { postgresTripStore, TripError, type TripStore } from "./store";
export type TripDependencies = {
  store: (url: string, enforce?: boolean, key?: string) => TripStore;
  authStore: (url: string) => AuthStore;
  now: () => Date;
};
export function tripRoutes(overrides: Partial<TripDependencies> = {}) {
  const deps: TripDependencies = {
    store: postgresTripStore,
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
      maxSize: 16384,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  app.get("/mine", async (c) => {
    const raw = c.req.query("cursor");
    let cursor;
    try {
      if (raw) {
        if (raw.length > 300 || !/^[\w-]+$/.test(raw)) throw new Error();
        cursor = tripCursorSchema.parse(
          JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/"))),
        );
      }
    } catch {
      return c.json({ error: "invalid_cursor" }, 400);
    }
    return c.json(
      tripListSchema.parse(
        await deps
          .store(
            databaseUrl(c.env),
            c.env.ENVIRONMENT === "production",
            c.env.MEMBER_DATA_KEY,
          )
          .list(c.get("session").user.id, cursor),
      ),
    );
  });
  app.post("/", async (c) => {
    const parsed = createTripSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: "invalid_trip",
          fields: parsed.error.issues.map((i) => ({
            field: String(i.path[0] ?? ""),
            message: i.message,
          })),
        },
        400,
      );
    const result = await deps
      .store(
        databaseUrl(c.env),
        c.env.ENVIRONMENT === "production",
        c.env.MEMBER_DATA_KEY,
      )
      .create(c.get("session").user.id, parsed.data, deps.now());
    return c.json(
      tripResponseSchema.parse({ trip: result.trip }),
      result.created ? 201 : 200,
    );
  });
  app.put("/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = updateTripSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success)
      return c.json({ error: "invalid_trip" }, 400);
    const trip = await deps
      .store(
        databaseUrl(c.env),
        c.env.ENVIRONMENT === "production",
        c.env.MEMBER_DATA_KEY,
      )
      .update(c.get("session").user.id, id.data, input.data, deps.now());
    return c.json(tripResponseSchema.parse({ trip }));
  });
  app.post("/:id/cancel", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = cancelTripSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success)
      return c.json({ error: "invalid_trip" }, 400);
    const trip = await deps
      .store(
        databaseUrl(c.env),
        c.env.ENVIRONMENT === "production",
        c.env.MEMBER_DATA_KEY,
      )
      .cancel(c.get("session").user.id, id.data, input.data, deps.now());
    return c.json(tripResponseSchema.parse({ trip }));
  });
  app.onError((error, c) => {
    if (error instanceof MembershipError)
      return c.json({ error: error.message }, 403);
    if (error instanceof TripError) {
      const status =
        error.code === "trip_not_found"
          ? 404
          : error.code === "departure_in_past"
            ? 400
            : 409;
      return c.json({ error: error.code }, status);
    }
    return c.json({ error: "service_unavailable" }, 503);
  });
  return app;
}
