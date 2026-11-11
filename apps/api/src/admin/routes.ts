import { adminCookie, managedAdminSession } from "../admin-auth/session";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { withDatabase, users, externalIdentities, adminAudit } from "@coago/db";
import { eq, and, sql } from "drizzle-orm";
import { assertManager } from "./store";
import {
  adminUserActionSchema,
  adminGrantSchema,
  adminSettingsActionSchema,
  adminCancelTripSchema,
  tripCursorSchema,
  adminOverviewSchema,
  adminLists,
} from "@coago/contracts";
import { databaseUrl, type Bindings } from "../bindings";
import { postgresAuthStore, type AuthStore, type Session } from "../auth/store";
import { hash } from "../auth/crypto";
import { lineConfig } from "../auth/line";
import { TripError } from "../trips/store";
import { isRoot, isAdmin, rootSubject, readSiteSettings } from "./access";
import { postgresAdminStore, AdminError, type AdminStore } from "./store";
export type AdminDependencies = {
  authStore: (url: string) => AuthStore;
  store: (url: string, subject?: string) => AdminStore;
  role: typeof isRoot;
  admin: typeof isAdmin;
  site: typeof readSiteSettings;
  now: () => Date;
};
export function adminRoutes(overrides: Partial<AdminDependencies> = {}) {
  const deps: AdminDependencies = {
    authStore: postgresAuthStore,
    store: postgresAdminStore,
    role: isRoot,
    admin: isAdmin,
    site: readSiteSettings,
    now: () => new Date(),
    ...overrides,
  };
  const app = new Hono<{
    Bindings: Bindings;
    Variables: { session: Session; root: boolean };
  }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(c, adminCookie(c.env));
    if (!token || !/^[a-f\d]{64}$/.test(token))
      return c.json({ error: "unauthorized" }, 401);
    const session = c.env.NEON_ADMIN_AUTH_URL
      ? await managedAdminSession(c.env, token)
      : await deps
          .authStore(databaseUrl(c.env))
          .getSession(await hash(token), deps.now());
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("session", session);
    const root =
      session.rootVerified === true &&
      (await deps.role(
        databaseUrl(c.env),
        session.user.id,
        rootSubject(c.env),
      ));
    c.set("root", root);
    const admin =
      !root && (await deps.admin(databaseUrl(c.env), session.user.id));
    if (["/me", "/api/admin/me"].includes(c.req.path) && c.req.method === "GET")
      return c.json({ role: root ? "root" : admin ? "admin" : "user" });
    if (!root && !admin) return c.json({ error: "forbidden" }, 403);
    if (!root && /\/(?:settings|role|accounts)$/.test(c.req.path))
      return c.json({ error: "forbidden" }, 403);
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
  const actor = (c: { get: (key: "session") => Session }) =>
    c.get("session").user.id;
  const store = (env: Bindings) =>
    deps.store(databaseUrl(env), rootSubject(env));
  app.get("/accounts", async (c) =>
    withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, actor(c), rootSubject(c.env), true);
        const items = await tx
          .select({
            id: users.id,
            displayName: users.displayName,
            status: users.status,
            role: users.role,
            email: externalIdentities.subject,
          })
          .from(users)
          .innerJoin(
            externalIdentities,
            eq(users.id, externalIdentities.userId),
          )
          .where(eq(externalIdentities.provider, "admin_email"))
          .limit(100);
        return c.json({ items });
      }),
    ),
  );
  app.post("/accounts", async (c) => {
    const input = z
      .object({
        email: z.email().transform((v) => v.toLowerCase()),
        name: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(300),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "invalid_request" }, 400);
    if (!c.env.NEON_ADMIN_AUTH_URL)
      return c.json({ error: "admin_auth_not_configured" }, 503);
    if (input.data.email === (c.env.ROOT_ADMIN_EMAIL ?? "").toLowerCase())
      return c.json({ error: "root_protected" }, 409);
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, actor(c), rootSubject(c.env), true);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${"staff-login:" + input.data.email},0))`,
        );
        const [existing] = await tx
          .select()
          .from(externalIdentities)
          .where(
            and(
              eq(externalIdentities.provider, "admin_email"),
              eq(externalIdentities.subject, input.data.email),
            ),
          );
        if (existing) return c.json({ error: "conflict" }, 409);
        const id = crypto.randomUUID();
        await tx
          .insert(users)
          .values({ id, displayName: input.data.name, role: "admin" });
        await tx
          .insert(externalIdentities)
          .values({
            provider: "admin_email",
            subject: input.data.email,
            userId: id,
          });
        await tx
          .insert(adminAudit)
          .values({
            id: crypto.randomUUID(),
            actorId: actor(c),
            action: "admin_granted",
            targetType: "user",
            targetId: id,
            reason: input.data.reason,
            details: { invited: true, after: "admin" },
          });
        return c.json({ id }, 201);
      }),
    );
  });
  app.get("/overview", async (c) =>
    c.json(adminOverviewSchema.parse(await store(c.env).overview(actor(c)))),
  );
  app.get("/settings", async (c) =>
    c.json(await store(c.env).settings(actor(c))),
  );
  for (const kind of ["users", "trips", "requests", "audit"] as const)
    app.get(`/${kind}`, async (c) => {
      let cursor;
      const query = c.req.query();
      try {
        if (Object.keys(query).some((k) => k !== "cursor")) throw new Error();
        if (query.cursor !== undefined) {
          if (
            !query.cursor ||
            query.cursor.length > 300 ||
            !/^[\w-]+$/.test(query.cursor)
          )
            throw new Error();
          cursor = tripCursorSchema.parse(
            JSON.parse(
              atob(query.cursor.replaceAll("-", "+").replaceAll("_", "/")),
            ),
          );
        }
      } catch {
        return c.json({ error: "invalid_cursor" }, 400);
      }
      return c.json(
        adminLists[kind].parse(await store(c.env).list(actor(c), kind, cursor)),
      );
    });
  app.put("/users/:id/role", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = adminGrantSchema.safeParse(await c.req.json().catch(() => null));
    if (!id.success || !input.success)
      return c.json({ error: "invalid_request" }, 400);
    await store(c.env).setRole(actor(c), id.data, input.data, deps.now());
    return c.json({ status: "ok" });
  });
  app.put("/users/:id/status", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = adminUserActionSchema.safeParse(
        await c.req.json().catch(() => null),
      );
    if (!id.success || !input.success)
      return c.json({ error: "invalid_request" }, 400);
    await store(c.env).setUser(actor(c), id.data, input.data, deps.now());
    return c.json({ status: "ok" });
  });
  app.post("/trips/:id/cancel", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id")),
      input = adminCancelTripSchema.safeParse(
        await c.req.json().catch(() => null),
      );
    if (!id.success || !input.success)
      return c.json({ error: "invalid_request" }, 400);
    await store(c.env).cancelTrip(actor(c), id.data, input.data, deps.now());
    return c.json({ status: "ok" });
  });
  app.put("/settings", async (c) => {
    const input = adminSettingsActionSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(
      await store(c.env).setSettings(actor(c), input.data, deps.now()),
    );
  });
  app.onError((error, c) =>
    error instanceof AdminError
      ? c.json(
          { error: error.code },
          error.code === "forbidden"
            ? 403
            : error.code === "not_found"
              ? 404
              : 409,
        )
      : error instanceof TripError
        ? c.json({ error: error.code }, 409)
        : c.json({ error: "service_unavailable" }, 503),
  );
  return app;
}
