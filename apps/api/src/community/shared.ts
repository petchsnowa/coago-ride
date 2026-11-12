import type pg from "pg";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { withDatabase } from "@coago/db";
import { postgresAuthStore, type Session } from "../auth/store";
import { hash } from "../auth/crypto";
import { databaseUrl, type Bindings } from "../bindings";
export class CommunityError extends Error {
  constructor(
    public code: string,
    public status: 400 | 403 | 404 | 409 | 429 = 409,
  ) {
    super(code);
  }
}
export type MemberEnv = { Bindings: Bindings; Variables: { session: Session } };
export function memberApp() {
  const app = new Hono<MemberEnv>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(c, "__Host-coago_session");
    if (!token || !/^[a-f\d]{64}$/.test(token))
      return c.json({ error: "unauthorized" }, 401);
    const session = await postgresAuthStore(databaseUrl(c.env)).getSession(
      await hash(token),
      new Date(),
    );
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("session", session);
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      (c.req.header("Origin") !== c.env.APP_ORIGIN ||
        c.req.header("X-CSRF-Token") !== session.csrfToken ||
        c.req.header("Content-Type")?.split(";")[0] !== "application/json")
    )
      return c.json({ error: "forbidden" }, 403);
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  app.onError((e, c) =>
    e instanceof CommunityError
      ? c.json({ error: e.code }, e.status)
      : e instanceof z.ZodError
        ? c.json({ error: "invalid_input" }, 400)
        : c.json({ error: "service_unavailable" }, 503),
  );
  return app;
}
export async function transaction<T>(
  url: string,
  work: (client: pg.Client) => Promise<T>,
) {
  return withDatabase(url, async (_db, c) => {
    await c.query("BEGIN");
    try {
      const value = await work(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}
export async function memberLock(c: pg.Client, user: string, approved = true) {
  const u = await c.query(
    "SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",
    [user],
  );
  if (!u.rowCount) throw new CommunityError("forbidden", 403);
  if (approved) {
    const p = await c.query(
      "SELECT status FROM member_profiles WHERE user_id=$1 FOR SHARE",
      [user],
    );
    if (p.rows[0]?.status !== "approved")
      throw new CommunityError("member_verification_required", 403);
  }
}
const cursorSchema = z
  .object({
    at: z.string().datetime(),
    id: z.uuid(),
    filter: z.string().max(100),
  })
  .strict();
export function readCursor(raw: string | undefined, filter: string) {
  if (!raw) return;
  try {
    if (raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
    const d = cursorSchema.parse(
      JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (d.filter !== filter) throw Error();
    return d;
  } catch {
    throw new CommunityError("invalid_cursor", 400);
  }
}
export function cursor(at: Date, id: string, filter: string) {
  return btoa(JSON.stringify({ at: at.toISOString(), id, filter }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
