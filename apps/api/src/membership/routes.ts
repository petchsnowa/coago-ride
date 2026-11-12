import { validEvidenceImage } from "./image";
import { issueRoadProof } from "./road-proof";
import { adminCookie, managedAdminSession } from "../admin-auth/session";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { sql, eq, and, desc } from "drizzle-orm";
import {
  withDatabase,
  memberProfiles,
  vehicles,
  privateUploads,
  adminAudit,
} from "@coago/db";
import {
  consentVersion,
  tripCursorSchema,
  profileInputSchema,
  vehicleInputSchema,
  verificationDecisionSchema,
  pointSchema,
} from "@coago/contracts";
import { databaseUrl, type Bindings } from "../bindings";
import { postgresAuthStore, type Session } from "../auth/store";
import { hash } from "../auth/crypto";
import { isRoot, isAdmin, rootSubject } from "../admin/access";
import { dataKey, seal, decode, encode, unseal } from "./crypto";
import { assertManager } from "../admin/store";
import { z } from "zod";
const uuid = z.string().uuid();
export function membershipRoutes() {
  const app = new Hono<{
    Bindings: Bindings;
    Variables: { session: Session; manager: boolean };
  }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const token = getCookie(
      c,
      c.req.path.includes("/review")
        ? adminCookie(c.env)
        : "__Host-coago_session",
    );
    if (!token || !/^[a-f\d]{64}$/.test(token))
      return c.json({ error: "unauthorized" }, 401);
    const session =
      c.req.path.includes("/review") && c.env.NEON_ADMIN_AUTH_URL
        ? await managedAdminSession(c.env, token)
        : await postgresAuthStore(databaseUrl(c.env)).getSession(
            await hash(token),
            new Date(),
          );
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("session", session);
    c.set("manager", false);
    if (c.req.path.includes("/review")) {
      const manager =
        (session.rootVerified &&
          (await isRoot(
            databaseUrl(c.env),
            session.user.id,
            rootSubject(c.env),
          ))) ||
        (await isAdmin(databaseUrl(c.env), session.user.id));
      if (!manager) return c.json({ error: "forbidden" }, 403);
      c.set("manager", true);
    }
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      (c.req.header("Origin") !== c.env.APP_ORIGIN ||
        c.req.header("X-CSRF-Token") !== session.csrfToken)
    )
      return c.json({ error: "forbidden" }, 403);
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 2100000,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  const owner = (c: { get: (v: "session") => Session }) =>
    c.get("session").user.id;
  app.get("/status", async (c) =>
    withDatabase(databaseUrl(c.env), async (db) => {
      const [profile] = await db
        .select({
          status: memberProfiles.status,
          version: memberProfiles.version,
          reviewReason: memberProfiles.reviewReason,
        })
        .from(memberProfiles)
        .where(eq(memberProfiles.userId, owner(c)));
      return c.json({
        profile: profile ?? null,
        storageReady: !!c.env.PRIVATE_DOCUMENTS && !!c.env.MEMBER_DATA_KEY,
        mapsReady: !!c.env.ORS_API_KEY,
      });
    }),
  );
  app.post("/uploads/:purpose", async (c) => {
    if (c.req.header("X-Consent-Version") !== consentVersion)
      return c.json({ error: "consent_required" }, 400);
    const purpose = z
      .enum(["portrait", "document", "vehicle", "plate"])
      .parse(c.req.param("purpose"));
    if (!c.env.PRIVATE_DOCUMENTS)
      return c.json({ error: "private_storage_unavailable" }, 503);
    const key = await dataKey(c.env.MEMBER_DATA_KEY),
      bytes = new Uint8Array(await c.req.arrayBuffer()),
      mime = c.req.header("Content-Type");
    if (bytes.length > 524288 || !validEvidenceImage(bytes, mime))
      return c.json({ error: "invalid_image" }, 400);
    const id = crypto.randomUUID(),
      objectKey = `private/${owner(c)}/${id}`;
    try {
      return await withDatabase(databaseUrl(c.env), async (db) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${"uploads:" + owner(c)},0))`,
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended('uploads:global',0))`,
          );
          const global = (
            await tx.execute(
              sql`SELECT coalesce(sum(size),0)::bigint AS bytes,count(*) FILTER(WHERE created_at>now()-interval '1 day')::int AS daily FROM private_uploads`,
            )
          ).rows[0];
          if (
            Number(global.bytes) + bytes.length > 6 * 1024 * 1024 * 1024 ||
            Number(global.daily) >= 2500
          )
            return c.json({ error: "storage_limit" }, 429);
          const count = (
            await tx.execute(
              sql`SELECT count(*)::int AS n,count(*) FILTER(WHERE created_at>now()-interval '1 day')::int AS daily FROM private_uploads WHERE owner_id=${owner(c)}`,
            )
          ).rows[0];
          if (Number(count.n) >= 100 || Number(count.daily) >= 25)
            return c.json({ error: "upload_limit" }, 429);
          await c.env.PRIVATE_DOCUMENTS!.put(
            objectKey,
            await seal(key, bytes, objectKey),
            { httpMetadata: { contentType: "application/octet-stream" } },
          );
          try {
            await tx.insert(privateUploads).values({
              id,
              ownerId: owner(c),
              purpose,
              objectKey,
              contentType: mime!,
              size: bytes.length,
            });
          } catch (e) {
            await c.env.PRIVATE_DOCUMENTS!.delete(objectKey);
            throw e;
          }
          return c.json({ id }, 201);
        }),
      );
    } catch (error) {
      await c.env.PRIVATE_DOCUMENTS!.delete(objectKey).catch(() => {});
      throw error;
    }
  });
  app.get("/uploads/:id", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    return withDatabase(databaseUrl(c.env), async (db) => {
      const [file] = await db
        .select()
        .from(privateUploads)
        .where(eq(privateUploads.id, id));
      if (!file || file.ownerId !== owner(c))
        return c.json({ error: "not_found" }, 404);
      if (!c.env.PRIVATE_DOCUMENTS)
        return c.json({ error: "private_storage_unavailable" }, 503);
      const blob = await c.env.PRIVATE_DOCUMENTS.get(file.objectKey);
      if (!blob) return c.json({ error: "not_found" }, 404);
      return new Response(
        await unseal(
          await dataKey(c.env.MEMBER_DATA_KEY),
          await blob.text(),
          file.objectKey,
        ),
        {
          headers: {
            "Content-Type": file.contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        },
      );
    });
  });
  app.get("/trip-photo/:id", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    return withDatabase(databaseUrl(c.env), async (db) => {
      const p = (
        await db
          .select()
          .from(memberProfiles)
          .where(eq(memberProfiles.userId, owner(c)))
      )[0];
      if (p?.status !== "approved")
        return c.json({ error: "member_verification_required" }, 403);
      const row = (
        await db.execute(
          sql`SELECT v.id,v.owner_id,v.data FROM trips t JOIN vehicles v ON v.id=(t.safety->>'vehicleId')::uuid WHERE t.id=${id} AND t.status='active' AND t.departure_at>now() AND v.status='approved' AND v.version=(t.safety->>'vehicleVersion')::int`,
        )
      ).rows[0];
      if (!row || !c.env.PRIVATE_DOCUMENTS)
        return c.json({ error: "not_found" }, 404);
      const data = await decode<{ photoId: string }>(
          await dataKey(c.env.MEMBER_DATA_KEY),
          String(row.data),
          `vehicle:${row.id}:${row.owner_id}`,
        ),
        file = (
          await db
            .select()
            .from(privateUploads)
            .where(
              and(
                eq(privateUploads.id, data.photoId),
                eq(privateUploads.ownerId, String(row.owner_id)),
                eq(privateUploads.purpose, "vehicle"),
              ),
            )
        )[0];
      if (!file) return c.json({ error: "not_found" }, 404);
      const blob = await c.env.PRIVATE_DOCUMENTS.get(file.objectKey);
      if (!blob) return c.json({ error: "not_found" }, 404);
      return new Response(
        await unseal(
          await dataKey(c.env.MEMBER_DATA_KEY),
          await blob.text(),
          file.objectKey,
        ),
        {
          headers: {
            "Content-Type": file.contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        },
      );
    });
  });
  // Homepage DTO deliberately omits identity numbers, phone, plate and evidence documents.
  app.get("/home", async (c) =>
    withDatabase(databaseUrl(c.env), async (db) => {
      const userId = owner(c);
      const [profile] = await db
        .select()
        .from(memberProfiles)
        .where(eq(memberProfiles.userId, userId));
      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.ownerId, userId))
        .orderBy(desc(vehicles.updatedAt), desc(vehicles.id))
        .limit(1);
      const key =
        profile || vehicle ? await dataKey(c.env.MEMBER_DATA_KEY) : null;
      const memberData = profile
        ? await decode<{ portraitId: string }>(
            key!,
            profile.data,
            `profile:${userId}`,
          )
        : null;
      const carData = vehicle
        ? await decode<{ photoId: string }>(
            key!,
            vehicle.data,
            `vehicle:${vehicle.id}:${userId}`,
          )
        : null;
      return c.json({
        member: profile
          ? { status: profile.status, portraitId: memberData!.portraitId }
          : null,
        vehicle: vehicle
          ? {
              brand: vehicle.brand,
              model: vehicle.model,
              color: vehicle.color,
              status: vehicle.status,
              photoId: carData!.photoId,
            }
          : null,
      });
    }),
  );
  app.get("/profile", async (c) =>
    withDatabase(databaseUrl(c.env), async (db) => {
      const [row] = await db
        .select()
        .from(memberProfiles)
        .where(eq(memberProfiles.userId, owner(c)));
      return c.json(
        row
          ? {
              ...(await decode<Record<string, unknown>>(
                await dataKey(c.env.MEMBER_DATA_KEY),
                row.data,
                `profile:${owner(c)}`,
              )),
              status: row.status,
              version: row.version,
              reviewReason: row.reviewReason,
            }
          : null,
      );
    }),
  );
  async function assets(
    tx: import("../trips/store").TripTransaction,
    user: string,
    ids: [string, string][],
  ) {
    for (const [id, purpose] of ids) {
      const [asset] = await tx
        .select()
        .from(privateUploads)
        .where(
          and(
            eq(privateUploads.id, id),
            eq(privateUploads.ownerId, user),
            eq(privateUploads.purpose, purpose),
          ),
        );
      if (!asset) throw new Error("INVALID_UPLOAD");
    }
  }
  app.put("/profile", async (c) => {
    const input = profileInputSchema.parse(await c.req.json()),
      key = await dataKey(c.env.MEMBER_DATA_KEY),
      id = owner(c);
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${"member:" + id},0))`,
        );
        const [before] = await tx
          .select()
          .from(memberProfiles)
          .where(eq(memberProfiles.userId, id))
          .for("update");
        if ((before?.version ?? 0) !== input.version)
          return c.json({ error: "conflict" }, 409);
        await assets(tx, id, [
          [input.portraitId, "portrait"],
          [input.documentId, "document"],
        ]);
        const values = {
          data: await seal(key, encode(input), `profile:${id}`),
          documentLast4: input.documentNumber.slice(-4),
          status: "pending",
          version: input.version + 1,
          reviewReason: null,
          reviewedBy: null,
          updatedAt: new Date(),
        };
        await tx
          .insert(memberProfiles)
          .values({ userId: id, ...values })
          .onConflictDoUpdate({ target: memberProfiles.userId, set: values });
        return c.json({ status: "pending", version: values.version });
      }),
    );
  });
  app.get("/vehicles", async (c) =>
    withDatabase(databaseUrl(c.env), async (db) => {
      const rows = await db
          .select()
          .from(vehicles)
          .where(eq(vehicles.ownerId, owner(c))),
        key = await dataKey(c.env.MEMBER_DATA_KEY);
      return c.json({
        vehicles: await Promise.all(
          rows.map(async (r) => ({
            id: r.id,
            ...(await decode<Record<string, unknown>>(
              key,
              r.data,
              `vehicle:${r.id}:${owner(c)}`,
            )),
            status: r.status,
            version: r.version,
            reviewReason: r.reviewReason,
          })),
        ),
      });
    }),
  );
  app.put("/vehicles/:id", async (c) => {
    const id = uuid.parse(c.req.param("id")),
      input = vehicleInputSchema.parse(await c.req.json()),
      key = await dataKey(c.env.MEMBER_DATA_KEY);
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${"member:" + owner(c)},0))`,
        );
        const [before] = await tx
          .select()
          .from(vehicles)
          .where(eq(vehicles.id, id))
          .for("update");
        if (before && before.ownerId !== owner(c))
          return c.json({ error: "not_found" }, 404);
        if (
          before &&
          (
            await tx.execute(
              sql`SELECT 1 FROM trips WHERE owner_id=${owner(c)} AND safety->>'vehicleId'=${id} AND status='active' AND seats_booked>0 AND departure_at>now()`,
            )
          ).rowCount
        )
          return c.json({ error: "vehicle_bookings_locked" }, 409);
        if ((before?.version ?? 0) !== input.version)
          return c.json({ error: "conflict" }, 409);
        if (!before) {
          const n = (
            await tx.execute(
              sql`SELECT count(*)::int AS n FROM vehicles WHERE owner_id=${owner(c)}`,
            )
          ).rows[0].n;
          if (Number(n) >= 10) return c.json({ error: "vehicle_limit" }, 409);
        }
        await assets(tx, owner(c), [
          [input.photoId, "vehicle"],
          [input.platePhotoId, "plate"],
        ]);
        const values = {
          brand: input.brand,
          model: input.model,
          color: input.color,
          capacity: input.seats,
          data: await seal(key, encode(input), `vehicle:${id}:${owner(c)}`),
          status: "pending",
          version: input.version + 1,
          reviewReason: null,
          reviewedBy: null,
          updatedAt: new Date(),
        };
        await tx
          .insert(vehicles)
          .values({ id, ownerId: owner(c), ...values })
          .onConflictDoUpdate({ target: vehicles.id, set: values });
        return c.json({ id, status: "pending", version: values.version });
      }),
    );
  });
  // Review access never returns document numbers in lists. Individual sensitive reads are audited.
  app.get("/review/:kind", async (c) => {
    const kind = z.enum(["profiles", "vehicles"]).parse(c.req.param("kind")),
      raw = c.req.query("cursor");
    let cursor: import("@coago/contracts").TripCursor | undefined;
    if (raw) {
      if (raw.length > 300 || !/^[A-Za-z0-9_-]+$/.test(raw))
        return c.json({ error: "invalid_cursor" }, 400);
      cursor = tripCursorSchema.parse(
        JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/"))),
      );
    }
    return withDatabase(databaseUrl(c.env), (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, owner(c), rootSubject(c.env));
        const table = kind === "profiles" ? memberProfiles : vehicles,
          id = kind === "profiles" ? memberProfiles.userId : vehicles.id,
          after = cursor
            ? sql`(${table.updatedAt},${id})<(${new Date(cursor.createdAt)},${cursor.id}::uuid)`
            : sql`true`;
        const rows =
          kind === "profiles"
            ? await tx
                .select({
                  id: memberProfiles.userId,
                  status: memberProfiles.status,
                  version: memberProfiles.version,
                  last4: memberProfiles.documentLast4,
                  updatedAt: memberProfiles.updatedAt,
                })
                .from(memberProfiles)
                .where(after)
                .orderBy(
                  desc(memberProfiles.updatedAt),
                  desc(memberProfiles.userId),
                )
                .limit(21)
            : await tx
                .select({
                  id: vehicles.id,
                  ownerId: vehicles.ownerId,
                  brand: vehicles.brand,
                  model: vehicles.model,
                  status: vehicles.status,
                  version: vehicles.version,
                  updatedAt: vehicles.updatedAt,
                })
                .from(vehicles)
                .where(after)
                .orderBy(desc(vehicles.updatedAt), desc(vehicles.id))
                .limit(21);
        const items = rows.slice(0, 20),
          last = items.at(-1);
        return c.json({
          items,
          nextCursor:
            rows.length > 20 && last
              ? btoa(
                  JSON.stringify({
                    createdAt: last.updatedAt.toISOString(),
                    id: last.id,
                  }),
                )
                  .replaceAll("+", "-")
                  .replaceAll("/", "_")
                  .replaceAll("=", "")
              : null,
        });
      }),
    );
  });
  app.get("/review/:kind/:id", async (c) => {
    const kind = z.enum(["profiles", "vehicles"]).parse(c.req.param("kind")),
      id = uuid.parse(c.req.param("id"));
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, owner(c), rootSubject(c.env));
        const row =
          kind === "profiles"
            ? (
                await tx
                  .select()
                  .from(memberProfiles)
                  .where(eq(memberProfiles.userId, id))
              )[0]
            : (await tx.select().from(vehicles).where(eq(vehicles.id, id)))[0];
        if (!row) return c.json({ error: "not_found" }, 404);
        const user = "userId" in row ? row.userId : row.ownerId,
          data = await decode<Record<string, unknown>>(
            await dataKey(c.env.MEMBER_DATA_KEY),
            row.data,
            kind === "profiles" ? `profile:${user}` : `vehicle:${id}:${user}`,
          );
        await tx.insert(adminAudit).values({
          id: crypto.randomUUID(),
          actorId: owner(c),
          action: "private_document_viewed",
          targetType: "user",
          targetId: user,
          reason: "เปิดข้อมูลเพื่อตรวจยืนยัน",
          details: { kind, id },
          createdAt: new Date(),
        });
        return c.json({
          id,
          ...data,
          status: row.status,
          version: row.version,
        });
      }),
    );
  });
  app.get("/review-file/:id", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, owner(c), rootSubject(c.env));
        const [file] = await tx
          .select()
          .from(privateUploads)
          .where(eq(privateUploads.id, id));
        if (!file || !c.env.PRIVATE_DOCUMENTS)
          return c.json({ error: "not_found" }, 404);
        const blob = await c.env.PRIVATE_DOCUMENTS.get(file.objectKey);
        if (!blob) return c.json({ error: "not_found" }, 404);
        const plain = await unseal(
          await dataKey(c.env.MEMBER_DATA_KEY),
          await blob.text(),
          file.objectKey,
        );
        await tx.insert(adminAudit).values({
          id: crypto.randomUUID(),
          actorId: owner(c),
          action: "private_document_viewed",
          targetType: "user",
          targetId: file.ownerId,
          reason: "เปิดรูปเพื่อตรวจยืนยัน",
          details: { uploadId: id },
          createdAt: new Date(),
        });
        return new Response(plain, {
          headers: {
            "Content-Type": file.contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      }),
    );
  });
  app.put("/review/:kind/:id", async (c) => {
    const kind = z.enum(["profiles", "vehicles"]).parse(c.req.param("kind")),
      id = uuid.parse(c.req.param("id")),
      input = verificationDecisionSchema.parse(await c.req.json());
    return withDatabase(databaseUrl(c.env), async (db) =>
      db.transaction(async (tx) => {
        await assertManager(tx, owner(c), rootSubject(c.env));
        const table = kind === "profiles" ? memberProfiles : vehicles,
          where =
            kind === "profiles"
              ? eq(memberProfiles.userId, id)
              : eq(vehicles.id, id),
          row = (await tx.select().from(table).where(where).for("update"))[0];
        if (!row) return c.json({ error: "not_found" }, 404);
        if (row.version !== input.version)
          return c.json({ error: "conflict" }, 409);
        const target = "userId" in row ? row.userId : row.ownerId;
        if (target === owner(c))
          return c.json({ error: "self_review_forbidden" }, 403);
        await tx
          .update(table)
          .set({
            status: input.decision,
            version: row.version + 1,
            reviewReason: input.reason,
            reviewedBy: owner(c),
            updatedAt: new Date(),
          })
          .where(where);
        await tx.insert(adminAudit).values({
          id: crypto.randomUUID(),
          actorId: owner(c),
          action: kind === "profiles" ? "profile_reviewed" : "vehicle_reviewed",
          targetType: "user",
          targetId: target,
          reason: input.reason,
          details: { id, before: row.status, after: input.decision },
          createdAt: new Date(),
        });
        return c.json({ status: input.decision, version: row.version + 1 });
      }),
    );
  });
  app.post("/route", async (c) => {
    const input = z
      .object({ origin: pointSchema, destination: pointSchema })
      .strict()
      .parse(await c.req.json());
    const allowed = await withDatabase(databaseUrl(c.env), (db) =>
      db.transaction(async (tx) => {
        for (const [bucket, maximum] of [
          [`route-user:${owner(c)}:${Math.floor(Date.now() / 60000)}`, 10],
          [`route-global:${Math.floor(Date.now() / 86400000)}`, 500],
        ] as const) {
          const r = await tx.execute(
            sql`INSERT INTO auth_rate_limits(bucket,hits,expires_at) VALUES(${bucket},1,now()+interval '1 day') ON CONFLICT(bucket) DO UPDATE SET hits=auth_rate_limits.hits+1 RETURNING hits`,
          );
          if (Number(r.rows[0].hits) > maximum) return false;
        }
        return true;
      }),
    );
    if (!allowed) return c.json({ error: "route_limit" }, 429);
    if (!c.env.ORS_API_KEY)
      return c.json({ error: "road_routing_unavailable" }, 503);
    const r = await fetch(
      "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          Authorization: c.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [input.origin.lng, input.origin.lat],
            [input.destination.lng, input.destination.lat],
          ],
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok) return c.json({ error: "road_routing_unavailable" }, 503);
    const data = (await r.json()) as {
        features?: {
          geometry: { coordinates: number[][] };
          properties: { summary: { distance: number; duration: number } };
        }[];
      },
      route = data.features?.[0];
    if (!route || !Number.isFinite(route.properties.summary.distance))
      return c.json({ error: "road_routing_unavailable" }, 503);
    return c.json({
      distanceKm: Math.round(route.properties.summary.distance / 10) / 100,
      routeProof: await issueRoadProof(
        c.env.MEMBER_DATA_KEY,
        input.origin,
        input.destination,
        Math.round(route.properties.summary.distance / 10) / 100,
      ),
      durationMinutes: route.properties.summary.duration / 60,
      coordinates: route.geometry.coordinates,
      source: "road",
    });
  });
  app.onError((e, c) =>
    c.json(
      {
        error:
          e instanceof z.ZodError
            ? "invalid_input"
            : e.message === "INVALID_UPLOAD"
              ? "invalid_upload"
              : "service_unavailable",
      },
      e instanceof z.ZodError
        ? 400
        : e.message === "INVALID_UPLOAD"
          ? 400
          : 503,
    ),
  );
  return app;
}
