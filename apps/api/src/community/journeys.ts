import { withDatabase } from "@coago/db";
import {
  journeyStateSchema,
  journeyStages,
  journeyActionSchema,
  bangkokDate,
  journeyListSchema,
} from "@coago/contracts";
import { z } from "zod";
import type pg from "pg";
import { databaseUrl } from "../bindings";
import { hash } from "../auth/crypto";
import {
  memberApp,
  transaction,
  CommunityError,
  cursor,
  readCursor,
} from "./shared";
const iso = (v: unknown) => new Date(v as string).toISOString();
async function eligible(c: pg.Client, owner: string, at: Date, tripId: string) {
  return !!(
    await c.query(
      "SELECT 1 FROM member_profiles p JOIN driver_licenses l ON l.user_id=p.user_id WHERE p.user_id=$1 AND p.status='approved' AND l.status='approved' AND l.expires_on>=$2::date AND EXISTS(SELECT 1 FROM trips t JOIN vehicles v ON v.id=(t.safety->>'vehicleId')::uuid WHERE t.id=$3 AND v.owner_id=p.user_id AND v.status='approved' AND v.version=(t.safety->>'vehicleVersion')::int)",
      [owner, bangkokDate(at), tripId],
    )
  ).rowCount;
}
async function read(
  c: pg.Client,
  actor: string,
  id: string,
  staff = false,
  now = new Date(),
) {
  const t = (
    await c.query(
      "SELECT t.*,j.status AS journey_status,j.issue,j.version AS journey_version,j.updated_at AS journey_updated FROM trips t LEFT JOIN journeys j ON j.trip_id=t.id WHERE t.id=$1",
      [id],
    )
  ).rows[0];
  if (!t) throw new CommunityError("not_found", 404);
  if (
    !staff &&
    t.owner_id !== actor &&
    !(
      await c.query(
        "SELECT 1 FROM ride_requests WHERE trip_id=$1 AND passenger_id=$2 AND status='accepted'",
        [id, actor],
      )
    ).rowCount
  )
    throw new CommunityError("not_found", 404);
  const events = (
    await c.query(
      "SELECT id,status,issue,note,created_at FROM journey_events WHERE trip_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20",
      [id],
    )
  ).rows;
  const route =
    t.safety?.origin && t.safety?.destination
      ? { origin: t.safety.origin, destination: t.safety.destination }
      : null;
  return journeyStateSchema.parse({
    tripId: id,
    status: t.journey_status ?? "not_started",
    issue: t.issue ?? false,
    version: t.journey_version ?? 0,
    updatedAt: t.journey_updated ? iso(t.journey_updated) : null,
    canUpdate:
      !staff &&
      t.owner_id === actor &&
      t.status === "active" &&
      t.journey_status !== "completed",
    driverEligible: await eligible(
      c,
      t.owner_id,
      new Date(Math.max(now.getTime(), t.departure_at.getTime())),
      id,
    ),
    trip: {
      status: t.status,
      originProvince: t.origin_province,
      destinationProvince: t.destination_province,
      departureAt: iso(t.departure_at),
      pickupPoint: t.pickup_point,
      dropoffPoint: t.dropoff_point,
      route,
    },
    events: events.map((e) => ({ ...e, createdAt: iso(e.created_at) })),
  });
}
export async function readJourney(
  url: string,
  actor: string,
  id: string,
  staff = false,
  now = new Date(),
) {
  return withDatabase(url, (_db, c) => read(c, actor, id, staff, now));
}
export async function updateJourney(
  url: string,
  actor: string,
  id: string,
  input: z.infer<typeof journeyActionSchema>,
  now = new Date(),
) {
  const fingerprint = await hash(
    JSON.stringify({
      tripId: id,
      status: input.status,
      issue: input.issue,
      note: input.note,
    }),
  );
  return transaction(url, async (c) => {
    const t = (
      await c.query(
        "SELECT * FROM trips WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id, actor],
      )
    ).rows[0];
    if (!t) throw new CommunityError("not_found", 404);
    if (
      !(
        await c.query(
          "SELECT 1 FROM users WHERE id=$1 AND status='active' FOR SHARE",
          [actor],
        )
      ).rowCount
    )
      throw new CommunityError("forbidden", 403);
    const same = (
      await c.query(
        "SELECT trip_id,payload_hash FROM journey_events WHERE actor_id=$1 AND request_id=$2",
        [actor, input.requestId],
      )
    ).rows[0];
    if (same) {
      if (same.trip_id !== id || same.payload_hash !== fingerprint)
        throw new CommunityError("request_reused");
      return read(c, actor, id, false, now);
    }
    if (t.status !== "active") throw new CommunityError("trip_cancelled");
    const before = (
        await c.query("SELECT * FROM journeys WHERE trip_id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0],
      current = before?.status ?? "not_started",
      issue = before?.issue ?? false;
    if ((before?.version ?? 0) !== input.version)
      throw new CommunityError("conflict");
    const a = journeyStages.indexOf(current),
      b = journeyStages.indexOf(input.status);
    if (
      current === "completed" ||
      b < a ||
      b > a + 1 ||
      (a === b && issue === input.issue && !input.note)
    )
      throw new CommunityError("invalid_transition");
    if (
      (input.issue && !input.note) ||
      (issue && !input.issue && input.note.length < 5)
    )
      throw new CommunityError("issue_reason_required", 400);
    if (a !== b) {
      if (now.getTime() < t.departure_at.getTime() - 86400000)
        throw new CommunityError("journey_too_early");
      if (issue || input.issue) throw new CommunityError("resolve_issue_first");
      if (
        b <= 3 &&
        !(await eligible(
          c,
          actor,
          new Date(Math.max(now.getTime(), t.departure_at.getTime())),
          id,
        ))
      )
        throw new CommunityError("driver_license_required", 403);
    }
    await c.query(
      "INSERT INTO journeys(trip_id,status,issue,version,updated_at) VALUES($1,$2,$3,1,$4) ON CONFLICT(trip_id) DO UPDATE SET status=$2,issue=$3,version=journeys.version+1,updated_at=$4",
      [id, input.status, input.issue, now],
    );
    await c.query(
      "INSERT INTO journey_events(id,trip_id,actor_id,request_id,payload_hash,status,issue,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        crypto.randomUUID(),
        id,
        actor,
        input.requestId,
        fingerprint,
        input.status,
        input.issue,
        input.note,
        now,
      ],
    );
    return read(c, actor, id, false, now);
  });
}
export async function listJourneys(url: string, raw?: string) {
  const after = readCursor(raw, "staff-journeys");
  return withDatabase(url, async (_db, c) => {
    const rows = (
        await c.query(
          "SELECT t.id AS trip_id,u.display_name AS owner_name,t.origin_province,t.destination_province,t.departure_at,coalesce(j.status,'not_started') AS status,coalesce(j.issue,false) AS issue,coalesce(j.updated_at,t.created_at) AS updated_at FROM trips t JOIN users u ON u.id=t.owner_id LEFT JOIN journeys j ON j.trip_id=t.id WHERE ($1::timestamptz IS NULL OR (coalesce(j.updated_at,t.created_at),t.id)<($1::timestamptz,$2::uuid)) ORDER BY coalesce(j.updated_at,t.created_at) DESC,t.id DESC LIMIT 21",
          [after ? new Date(after.at) : null, after?.id ?? null],
        )
      ).rows,
      items = rows.slice(0, 20),
      last = items.at(-1);
    return journeyListSchema.parse({
      items: items.map((r) => ({
        tripId: r.trip_id,
        ownerName: r.owner_name,
        originProvince: r.origin_province,
        destinationProvince: r.destination_province,
        departureAt: iso(r.departure_at),
        status: r.status,
        issue: r.issue,
        updatedAt: iso(r.updated_at),
      })),
      nextCursor:
        rows.length > 20 && last
          ? cursor(last.updated_at, last.trip_id, "staff-journeys")
          : null,
    });
  });
}
export function journeyRoutes() {
  const app = memberApp();
  app.get("/:id", async (c) =>
    c.json(
      await readJourney(
        databaseUrl(c.env),
        c.get("session").user.id,
        z.uuid().parse(c.req.param("id")),
      ),
    ),
  );
  app.post("/:id", async (c) =>
    c.json(
      await updateJourney(
        databaseUrl(c.env),
        c.get("session").user.id,
        z.uuid().parse(c.req.param("id")),
        journeyActionSchema.parse(await c.req.json()),
      ),
    ),
  );
  return app;
}
