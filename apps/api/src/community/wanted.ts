import { Hono } from "hono";
import { z } from "zod";
import { withDatabase } from "@coago/db";
import {
  wantedDraftSchema,
  wantedPostSchema,
  publicWantedSchema,
  provinces,
  travelDateSchema,
  bangkokDayRange,
  type WantedDraft,
} from "@coago/contracts";
import { databaseUrl, type Bindings } from "../bindings";
import { readSiteSettings } from "../admin/access";
import { hash } from "../auth/crypto";
import {
  memberApp,
  memberLock,
  transaction,
  CommunityError,
  readCursor,
  cursor,
} from "./shared";
function dto(r: Record<string, unknown>) {
  return wantedPostSchema.parse({
    id: r.id,
    originProvince: r.origin_province,
    destinationProvince: r.destination_province,
    departureFrom: new Date(r.departure_from as string).toISOString(),
    departureUntil: new Date(r.departure_until as string).toISOString(),
    seats: r.seats,
    budgetSatang: r.budget_satang,
    status: r.status,
    version: r.version,
    cancellationReason: r.cancellation_reason,
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  });
}
function dates(input: WantedDraft, now: Date) {
  if (
    new Date(input.departureFrom) <= now ||
    new Date(input.departureUntil).getTime() > now.getTime() + 90 * 86400000
  )
    throw new CommunityError("invalid_departure", 400);
}
export async function saveWanted(
  url: string,
  user: string,
  input: WantedDraft & { requestId?: string; version?: number },
  id?: string,
  now = new Date(),
) {
  const draft = wantedDraftSchema.parse(
      Object.fromEntries(
        Object.keys(wantedDraftSchema.shape).map((k) => [
          k,
          input[k as keyof typeof input],
        ]),
      ),
    ),
    fingerprint = await hash(JSON.stringify(draft));
  return transaction(url, async (c) => {
    await memberLock(c, user);
    if (!id) {
      const same = (
        await c.query(
          "SELECT * FROM wanted_posts WHERE owner_id=$1 AND request_id=$2",
          [user, input.requestId],
        )
      ).rows[0];
      if (same) {
        if (same.payload_hash !== fingerprint)
          throw new CommunityError("request_reused");
        return dto(same);
      }
    }
    const before = id
      ? (
          await c.query(
            "SELECT * FROM wanted_posts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [id, user],
          )
        ).rows[0]
      : null;
    if (id && !before) throw new CommunityError("not_found", 404);
    if (
      before &&
      (before.version !== input.version || before.status !== "active")
    )
      throw new CommunityError("conflict");
    dates(draft, now);
    if (
      !id &&
      Number(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM wanted_posts WHERE owner_id=$1 AND status='active' AND departure_until>$2",
            [user, now],
          )
        ).rows[0].n,
      ) >= 5
    )
      throw new CommunityError("wanted_limit", 429);
    const fields = [
      draft.originProvince,
      draft.destinationProvince,
      new Date(draft.departureFrom),
      new Date(draft.departureUntil),
      draft.seats,
      draft.budgetSatang,
      fingerprint,
      now,
    ];
    const r = before
      ? await c.query(
          "UPDATE wanted_posts SET origin_province=$1,destination_province=$2,departure_from=$3,departure_until=$4,seats=$5,budget_satang=$6,payload_hash=$7,updated_at=$8,version=version+1 WHERE id=$9 AND owner_id=$10 RETURNING *",
          [...fields, id, user],
        )
      : await c.query(
          "INSERT INTO wanted_posts(origin_province,destination_province,departure_from,departure_until,seats,budget_satang,payload_hash,updated_at,id,owner_id,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$8) RETURNING *",
          [...fields, crypto.randomUUID(), user, input.requestId],
        );
    return dto(r.rows[0]);
  });
}
export async function cancelWanted(
  url: string,
  user: string,
  id: string,
  input: { version: number; reason: string },
) {
  return transaction(url, async (c) => {
    await memberLock(c, user, false);
    const r = (
      await c.query(
        "SELECT * FROM wanted_posts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, user],
      )
    ).rows[0];
    if (!r) throw new CommunityError("not_found", 404);
    if (r.status === "cancelled" && r.cancellation_reason === input.reason)
      return dto(r);
    if (r.version !== input.version || r.status !== "active")
      throw new CommunityError("conflict");
    return dto(
      (
        await c.query(
          "UPDATE wanted_posts SET status='cancelled',cancellation_reason=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, input.reason],
        )
      ).rows[0],
    );
  });
}
export async function listWanted(
  url: string,
  query: Record<string, string> = {},
  user?: string,
  now = new Date(),
) {
  const filter = await hash(
      JSON.stringify({
        user: user ?? null,
        origin: query.originProvince ?? null,
        destination: query.destinationProvince ?? null,
        date: query.date ?? null,
      }),
    ),
    after = readCursor(query.cursor, filter);
  return withDatabase(url, async (_db, c) => {
    const p: unknown[] = [],
      bind = (v: unknown) => `$${p.push(v)}`,
      conds: string[] = [];
    if (user) conds.push(`w.owner_id=${bind(user)}`);
    else {
      conds.push(
        `w.status='active'`,
        `w.departure_until>${bind(now)}`,
        "EXISTS(SELECT 1 FROM users u JOIN member_profiles m ON m.user_id=u.id WHERE u.id=w.owner_id AND u.status='active' AND m.status='approved')",
      );
    }
    if (query.originProvince)
      conds.push(`w.origin_province=${bind(query.originProvince)}`);
    if (query.destinationProvince)
      conds.push(`w.destination_province=${bind(query.destinationProvince)}`);
    if (query.date) {
      const day = bangkokDayRange(query.date);
      conds.push(
        `w.departure_from<${bind(day.end)}`,
        `w.departure_until>=${bind(day.start)}`,
      );
    }
    const field = user ? "created_at" : "departure_from",
      direction = user ? "DESC" : "ASC";
    if (after)
      conds.push(
        `(w.${field},w.id)${user ? "<" : ">"}(${bind(new Date(after.at))},${bind(after.id)}::uuid)`,
      );
    const rows = (
        await c.query(
          `SELECT w.* FROM wanted_posts w WHERE ${conds.join(" AND ")} ORDER BY w.${field} ${direction},w.id ${direction} LIMIT 21`,
          p,
        )
      ).rows,
      page = rows.slice(0, 20),
      last = page.at(-1);
    return {
      posts: page.map((r) =>
        user
          ? dto(r)
          : publicWantedSchema.parse(
              Object.fromEntries(
                Object.keys(publicWantedSchema.shape).map((k) => [
                  k,
                  dto(r)[k as keyof ReturnType<typeof dto>],
                ]),
              ),
            ),
      ),
      nextCursor:
        rows.length > 20 && last ? cursor(last[field], last.id, filter) : null,
    };
  });
}
export function wantedRoutes() {
  const app = memberApp();
  app.get("/mine", async (c) =>
    c.json(
      await listWanted(
        databaseUrl(c.env),
        { cursor: c.req.query("cursor") ?? "" },
        c.get("session").user.id,
      ),
    ),
  );
  app.post("/", async (c) => {
    if (!(await readSiteSettings(databaseUrl(c.env))).serviceOpen)
      return c.json({ error: "service_closed" }, 503);
    const input = wantedDraftSchema
      .safeExtend({ requestId: z.uuid() })
      .parse(await c.req.json());
    return c.json(
      {
        post: await saveWanted(
          databaseUrl(c.env),
          c.get("session").user.id,
          input,
        ),
      },
      201,
    );
  });
  app.put("/:id", async (c) => {
    if (!(await readSiteSettings(databaseUrl(c.env))).serviceOpen)
      return c.json({ error: "service_closed" }, 503);
    const input = wantedDraftSchema
      .safeExtend({ version: z.number().int().positive() })
      .parse(await c.req.json());
    return c.json({
      post: await saveWanted(
        databaseUrl(c.env),
        c.get("session").user.id,
        input,
        z.uuid().parse(c.req.param("id")),
      ),
    });
  });
  app.post("/:id/cancel", async (c) =>
    c.json({
      post: await cancelWanted(
        databaseUrl(c.env),
        c.get("session").user.id,
        z.uuid().parse(c.req.param("id")),
        z
          .object({
            version: z.number().int().positive(),
            reason: z.string().trim().min(1).max(300),
          })
          .strict()
          .parse(await c.req.json()),
      ),
    }),
  );
  return app;
}
export function publicWantedRoutes() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use("*", async (c, n) => {
    c.header("Cache-Control", "no-store");
    await n();
  });
  app.get("/", async (c) => {
    const q = new URL(c.req.url).searchParams;
    if (new Set(q.keys()).size !== [...q.keys()].length)
      return c.json({ error: "invalid_search" }, 400);
    const fields = z
      .object({
        originProvince: z.enum(provinces).optional(),
        destinationProvince: z.enum(provinces).optional(),
        date: travelDateSchema.optional(),
        cursor: z.string().max(400).optional(),
      })
      .strict()
      .parse(Object.fromEntries(q));
    return c.json(await listWanted(databaseUrl(c.env), fields));
  });
  app.onError((e, c) =>
    e instanceof z.ZodError
      ? c.json({ error: "invalid_search" }, 400)
      : e instanceof CommunityError
        ? c.json({ error: e.code }, e.status)
        : c.json({ error: "service_unavailable" }, 503),
  );
  return app;
}
