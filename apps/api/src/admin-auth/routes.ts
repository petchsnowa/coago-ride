import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { sql, eq, and } from "drizzle-orm";
import {
  withDatabase,
  users,
  externalIdentities,
  authSessions,
  adminAudit,
} from "@coago/db";
import { databaseUrl, type Bindings } from "../bindings";
import { hash, randomToken } from "../auth/crypto";
import { dataKey, encode, seal } from "../membership/crypto";
import {
  adminProvider,
  upstream,
  providerSession,
  providerCookies,
} from "./provider";
import { managedAdminSession } from "./session";
const email = z.email().transform((v) => v.trim().toLowerCase());
const loginSchema = z
  .object({ email, password: z.string().min(12).max(128) })
  .strict();
export function adminAuthRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (
      c.env.ENVIRONMENT === "production" &&
      new URL(c.req.url).origin !== c.env.APP_ORIGIN
    )
      return c.json({ error: "canonical_origin_required" }, 403);
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      (c.req.header("Origin") !== c.env.APP_ORIGIN ||
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
  app.get("/config", (c) => {
    let enabled = false;
    try {
      adminProvider(c.env);
      enabled = !!c.env.MEMBER_DATA_KEY;
    } catch {
      /* fail closed */
    }
    return c.json({ enabled });
  });
  app.get("/me", async (c) => {
    if (!c.env.NEON_ADMIN_AUTH_URL)
      return c.json({ user: null, csrfToken: null, loginAvailable: false });
    const token = getCookie(c, "__Host-coago_admin"),
      session =
        token && /^[a-f\d]{64}$/.test(token)
          ? await managedAdminSession(c.env, token)
          : undefined;
    return c.json(
      session
        ? {
            user: session.user,
            csrfToken: session.csrfToken,
            loginAvailable: true,
          }
        : { user: null, csrfToken: null, loginAvailable: true },
    );
  });
  async function invited(env: Bindings, address: string) {
    if (address === (env.ROOT_ADMIN_EMAIL ?? "").trim().toLowerCase())
      return true;
    return withDatabase(
      databaseUrl(env),
      async (db) =>
        (
          await db.execute(
            sql`SELECT 1 FROM users u JOIN external_identities i ON i.user_id=u.id WHERE i.provider='admin_email' AND i.subject=${address} AND u.role='admin' AND u.status='active'`,
          )
        ).rowCount === 1,
    );
  }
  async function limit(env: Bindings, address: string, ip: string) {
    return withDatabase(databaseUrl(env), (db) =>
      db.transaction(async (tx) => {
        for (const bucket of [
          `staff-ip:${ip}:${Math.floor(Date.now() / 600000)}`,
          `staff-email:${await hash(address)}:${Math.floor(Date.now() / 600000)}`,
        ]) {
          const r = await tx.execute(
            sql`INSERT INTO auth_rate_limits(bucket,hits,expires_at) VALUES(${bucket},1,now()+interval '10 minutes') ON CONFLICT(bucket) DO UPDATE SET hits=auth_rate_limits.hits+1 RETURNING hits`,
          );
          if (Number(r.rows[0].hits) > 8) return false;
        }
        return true;
      }),
    );
  }
  async function mailBudget(env: Bindings, address: string) {
    return withDatabase(databaseUrl(env), (db) =>
      db.transaction(async (tx) => {
        for (const [bucket, maximum] of [
          [
            `staff-mail:${await hash(address)}:${Math.floor(Date.now() / 86400000)}`,
            10,
          ],
          [`staff-mail-global:${Math.floor(Date.now() / 86400000)}`, 80],
        ] as const) {
          const r = await tx.execute(
            sql`INSERT INTO auth_rate_limits(bucket,hits,expires_at) VALUES(${bucket},1,now()+interval '1 day') ON CONFLICT(bucket) DO UPDATE SET hits=auth_rate_limits.hits+1 RETURNING hits`,
          );
          if (Number(r.rows[0].hits) > maximum) return false;
        }
        return true;
      }),
    );
  }
  app.post("/login", async (c) => {
    const input = loginSchema.parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        input.email,
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    if (!(await invited(c.env, input.email)))
      return c.json({ error: "invalid_credentials" }, 401);
    const response = await upstream(c.env, "/sign-in/email", {
      email: input.email,
      password: input.password,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return c.json({ error: "invalid_credentials_or_unverified_email" }, 401);
    }
    const cookie = providerCookies(response);
    await response.body?.cancel();
    const verified = await providerSession(c.env, cookie);
    if (verified.user.email !== input.email)
      return c.json({ error: "invalid_credentials" }, 401);
    const token = randomToken(),
      csrf = randomToken(),
      tokenHash = await hash(token),
      root =
        input.email === (c.env.ROOT_ADMIN_EMAIL ?? "").trim().toLowerCase(),
      key = await dataKey(c.env.MEMBER_DATA_KEY);
    const user = await withDatabase(databaseUrl(c.env), (db) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${"staff-login:" + input.email},0))`,
        );
        let identity = (
          await tx
            .select()
            .from(externalIdentities)
            .where(
              and(
                eq(externalIdentities.provider, "admin_email"),
                eq(externalIdentities.subject, input.email),
              ),
            )
        )[0];
        if (!identity) {
          if (!root) throw Error("ADMIN_NOT_INVITED");
          const id = crypto.randomUUID();
          await tx.insert(users).values({ id, displayName: "Root" });
          await tx.insert(externalIdentities).values({
            provider: "admin_email",
            subject: input.email,
            userId: id,
          });
          identity = {
            provider: "admin_email",
            subject: input.email,
            userId: id,
            createdAt: new Date(),
          };
          await tx
            .insert(adminAudit)
            .values({
              id: crypto.randomUUID(),
              actorId: id,
              action: "root_bootstrap",
              targetType: "user",
              targetId: id,
              reason: "ยืนยัน Root ด้วยรหัสผ่านและอีเมล",
              details: { provider: "neon" },
            })
            .onConflictDoNothing();
        }
        const [account] = await tx
          .select()
          .from(users)
          .where(eq(users.id, identity.userId))
          .for("update");
        if (account.status !== "active" || (!root && account.role !== "admin"))
          throw Error("ADMIN_NOT_INVITED");
        const expiresAt = new Date(
          Math.min(Date.now() + 3600000, verified.expiresAt.getTime()),
        );
        await tx.insert(authSessions).values({
          tokenHash,
          userId: account.id,
          csrfToken: csrf,
          rootVerified: root,
          adminProof: await seal(
            key,
            encode({
              cookie,
              email: input.email,
              providerId: verified.user.id,
            }),
            `admin:${tokenHash}`,
          ),
          expiresAt,
        });
        return { id: account.id, displayName: account.displayName };
      }),
    );
    setCookie(c, "__Host-coago_admin", token, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 3600,
    });
    return c.json({ user, csrfToken: csrf, loginAvailable: true });
  });
  app.post("/register", async (c) => {
    const input = loginSchema
      .extend({ name: z.string().trim().min(1).max(120) })
      .parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        input.email,
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    if (await invited(c.env, input.email)) {
      if (!(await mailBudget(c.env, input.email)))
        return c.json({ error: "email_limit" }, 429);
      const r = await upstream(c.env, "/sign-up/email", {
        email: input.email,
        password: input.password,
        name: input.name,
      });
      await r.body?.cancel();
      if (!r.ok)
        return c.json({ error: "account_exists_or_registration_failed" }, 409);
    }
    return c.json({
      message:
        "หากเป็นบัญชีที่ได้รับสิทธิ์ กรุณาตรวจอีเมลและยืนยันก่อนเข้าสู่ระบบ",
    });
  });
  app.post("/verify", async (c) => {
    const input = z
      .object({ email, otp: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        input.email,
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    if (!(await invited(c.env, input.email)))
      return c.json({ error: "invalid_verification" }, 400);
    const r = await upstream(c.env, "/email-otp/verify-email", input);
    await r.body?.cancel();
    return r.ok
      ? c.json({ verified: true })
      : c.json({ error: "invalid_verification" }, 400);
  });
  app.post("/resend", async (c) => {
    const input = z
      .object({ email })
      .strict()
      .parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        input.email,
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    if (await invited(c.env, input.email)) {
      if (!(await mailBudget(c.env, input.email)))
        return c.json({ error: "email_limit" }, 429);
      const r = await upstream(c.env, "/email-otp/send-verification-otp", {
        email: input.email,
        type: "email-verification",
      });
      await r.body?.cancel();
    }
    return c.json({ message: "หากบัญชีได้รับสิทธิ์ ระบบจะส่งอีเมลยืนยัน" });
  });
  app.post("/forgot", async (c) => {
    const input = z
      .object({ email })
      .strict()
      .parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        input.email,
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    if (await invited(c.env, input.email)) {
      if (!(await mailBudget(c.env, input.email)))
        return c.json({ error: "email_limit" }, 429);
      const r = await upstream(c.env, "/request-password-reset", {
        email: input.email,
        redirectTo: `${c.env.APP_ORIGIN}/admin?reset=1`,
      });
      await r.body?.cancel();
    }
    return c.json({
      message: "หากบัญชีได้รับสิทธิ์ ระบบจะส่งวิธีตั้งรหัสผ่านใหม่ทางอีเมล",
    });
  });
  app.post("/reset", async (c) => {
    const input = z
      .object({
        token: z.string().min(16).max(512),
        newPassword: z.string().min(12).max(128),
      })
      .strict()
      .parse(await c.req.json());
    if (
      !(await limit(
        c.env,
        "password-reset",
        c.req.header("CF-Connecting-IP") ?? "unknown",
      ))
    )
      return c.json({ error: "too_many_attempts" }, 429);
    const r = await upstream(c.env, "/reset-password", input);
    await r.body?.cancel();
    if (r.ok) {
      await withDatabase(databaseUrl(c.env), (db) =>
        db.delete(authSessions).where(sql`admin_proof IS NOT NULL`),
      );
      deleteCookie(c, "__Host-coago_admin", { path: "/", secure: true });
    }
    return r.ok
      ? c.json({ reset: true })
      : c.json({ error: "invalid_reset" }, 400);
  });
  app.post("/logout", async (c) => {
    const token = getCookie(c, "__Host-coago_admin");
    if (token && /^[a-f\d]{64}$/.test(token)) {
      const session = await managedAdminSession(c.env, token);
      if (session && c.req.header("X-CSRF-Token") !== session.csrfToken)
        return c.json({ error: "forbidden" }, 403);
      const tokenHash = await hash(token);
      await withDatabase(databaseUrl(c.env), (db) =>
        db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash)),
      );
    }
    deleteCookie(c, "__Host-coago_admin", { path: "/", secure: true });
    return c.body(null, 204);
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? "invalid_input"
            : "admin_auth_unavailable",
      },
      error instanceof z.ZodError
        ? 400
        : error.message === "ADMIN_EMAIL_UNVERIFIED"
          ? 401
          : 503,
    ),
  );
  return app;
}
