import type pg from "pg";
import { withDatabase } from "@coago/db";
import {
  rideRequestSchema,
  publicTripDetailSchema,
  type DecideRideRequest,
  type CreateRideRequest,
  type RideRequest,
  type RideRequestList,
  type RideRequestContext,
  type TripCursor,
} from "@coago/contracts";
export class RideRequestError extends Error {
  constructor(
    public code:
      | "trip_not_found"
      | "request_not_found"
      | "own_trip"
      | "trip_unavailable"
      | "already_requested"
      | "request_reused"
      | "request_not_pending"
      | "trip_changed"
      | "cancellation_closed"
      | "member_verification_required",
  ) {
    super(code);
  }
}
export interface RideRequestStore {
  create(
    actor: string,
    input: CreateRideRequest,
    now: Date,
  ): Promise<{ request: RideRequest; created: boolean }>;
  cancel(actor: string, id: string, now: Date): Promise<RideRequest>;
  decide(
    actor: string,
    id: string,
    input: DecideRideRequest,
    now: Date,
  ): Promise<RideRequest>;
  list(
    actor: string,
    kind: "mine" | "incoming",
    cursor?: TripCursor,
  ): Promise<RideRequestList>;
  context(
    actor: string,
    tripId: string,
    now: Date,
  ): Promise<RideRequestContext>;
}
type Row = {
  id: string;
  trip_id: string;
  passenger_id: string;
  request_id: string;
  status: string;
  seats_requested: number;
  trip_version: number;
  trip_snapshot: unknown;
  decided_at: Date | null;
  rejection_reason: string | null;
  seats_booked: number;
  created_at: Date;
  updated_at: Date;
  passenger_name: string;
  origin_province: string;
  destination_province: string;
  departure_at: Date;
  seats_offered: number;
  vehicle_model: string;
  vehicle_color: string;
  contribution_satang: number;
  trip_status: string;
  current_version: number;
};
const select = `SELECT r.id,r.trip_id,r.passenger_id,r.request_id,r.status,r.seats_requested,r.trip_version,r.trip_snapshot,r.decided_at,r.rejection_reason,r.created_at,r.updated_at,u.display_name AS passenger_name,t.origin_province,t.destination_province,t.departure_at,t.seats_offered,t.seats_booked,t.vehicle_model,t.vehicle_color,t.contribution_satang,t.status AS trip_status,t.version AS current_version FROM ride_requests r JOIN trips t ON t.id=r.trip_id JOIN users u ON u.id=r.passenger_id`;
function dto(row: Row): RideRequest {
  return rideRequestSchema.parse({
    id: row.id,
    status: row.status,
    offeredTrip: row.trip_snapshot,
    decidedAt: row.decided_at?.toISOString() ?? null,
    rejectionReason: row.rejection_reason,
    seatsRequested: row.seats_requested,
    passengerName: row.passenger_name,
    tripChanged: row.trip_version !== row.current_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    trip: {
      id: row.trip_id,
      originProvince: row.origin_province,
      destinationProvince: row.destination_province,
      departureAt: row.departure_at.toISOString(),
      seats: row.seats_offered - row.seats_booked,
      vehicleModel: row.vehicle_model,
      vehicleColor: row.vehicle_color,
      contributionSatang: row.contribution_satang,
      status: row.trip_status,
    },
  });
}
async function byId(client: pg.Client, id: string) {
  const { rows } = await client.query<Row>(`${select} WHERE r.id=$1`, [id]);
  if (!rows[0]) throw new RideRequestError("request_not_found");
  return dto(rows[0]);
}
type TripRow = {
  owner_status: string;
  journey_started: boolean;
  id: string;
  owner_id: string;
  status: string;
  seats_offered: number;
  seats_booked: number;
  origin_province: string;
  destination_province: string;
  pickup_point: string;
  dropoff_point: string;
  vehicle_model: string;
  vehicle_color: string;
  contribution_satang: number;
  luggage_notes: string;
  conditions: string;
  version: number;
  departure_at: Date;
};
const available = (trip: TripRow, now: Date) =>
  !trip.journey_started &&
  trip.status === "active" &&
  trip.owner_status === "active" &&
  trip.seats_offered > trip.seats_booked &&
  trip.departure_at > now;
const tripSelect =
  "SELECT EXISTS(SELECT 1 FROM journeys j WHERE j.trip_id=trips.id AND j.status IN ('travelling','arrived','completed')) AS journey_started,(SELECT u.status FROM users u WHERE u.id=trips.owner_id) AS owner_status,id,owner_id,status,seats_offered,seats_booked,version,departure_at,origin_province,destination_province,pickup_point,dropoff_point,vehicle_model,vehicle_color,contribution_satang,luggage_notes,conditions FROM trips";
function snapshot(trip: TripRow) {
  return publicTripDetailSchema.parse({
    id: trip.id,
    originProvince: trip.origin_province,
    destinationProvince: trip.destination_province,
    departureAt: trip.departure_at.toISOString(),
    seats: trip.seats_offered - trip.seats_booked,
    vehicleModel: trip.vehicle_model,
    vehicleColor: trip.vehicle_color,
    contributionSatang: trip.contribution_satang,
    pickupPoint: trip.pickup_point,
    dropoffPoint: trip.dropoff_point,
    luggageNotes: trip.luggage_notes,
    conditions: trip.conditions,
  });
}
async function transaction<T>(url: string, work: (c: pg.Client) => Promise<T>) {
  return withDatabase(url, async (_db, client) => {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}
async function safetyForRequest(
  client: pg.Client,
  tripId: string,
  passenger: string,
) {
  const p = await client.query(
    "SELECT status FROM member_profiles WHERE user_id=$1 FOR SHARE",
    [passenger],
  );
  if (p.rows[0]?.status !== "approved")
    throw new RideRequestError("member_verification_required");
  const driver = await client.query(
    "SELECT 1 FROM member_profiles p JOIN trips t ON t.owner_id=p.user_id JOIN vehicles v ON v.id=(t.safety->>'vehicleId')::uuid JOIN driver_licenses l ON l.user_id=t.owner_id AND l.status='approved' AND l.expires_on>=(t.departure_at AT TIME ZONE 'Asia/Bangkok')::date WHERE t.id=$1 AND p.status='approved' AND v.status='approved' AND v.owner_id=t.owner_id AND v.version=(t.safety->>'vehicleVersion')::int FOR SHARE OF p,v,l",
    [tripId],
  );
  if (!driver.rowCount) throw new RideRequestError("trip_unavailable");
}
export function postgresRideRequestStore(
  url: string,
  enforceSafety = false,
): RideRequestStore {
  return {
    async create(actor, input, now) {
      return transaction(url, async (client) => {
        const replay = await client.query<Row>(
          `${select} WHERE r.passenger_id=$1 AND r.request_id=$2`,
          [actor, input.requestId],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].trip_id !== input.tripId)
            throw new RideRequestError("request_reused");
          return { request: dto(replay.rows[0]), created: false };
        }
        const locked = await client.query<TripRow>(
          `${tripSelect} WHERE id=$1 FOR UPDATE`,
          [input.tripId],
        );
        const trip = locked.rows[0];
        if (!trip) throw new RideRequestError("trip_not_found");
        if (trip.owner_id === actor) throw new RideRequestError("own_trip");
        if (enforceSafety) await safetyForRequest(client, trip.id, actor);
        // Recheck after obtaining the trip lock: another call with this key may have committed.
        const same = await client.query<Row>(
          `${select} WHERE r.passenger_id=$1 AND r.request_id=$2`,
          [actor, input.requestId],
        );
        if (same.rows[0]) {
          if (same.rows[0].trip_id !== input.tripId)
            throw new RideRequestError("request_reused");
          return { request: dto(same.rows[0]), created: false };
        }
        if (
          (
            await client.query(
              "SELECT 1 FROM journeys WHERE trip_id=$1 AND status IN ('travelling','arrived','completed')",
              [trip.id],
            )
          ).rowCount
        )
          throw new RideRequestError("trip_unavailable");
        if (!available(trip, now))
          throw new RideRequestError("trip_unavailable");
        const pending = await client.query(
          "SELECT id FROM ride_requests WHERE passenger_id=$1 AND trip_id=$2 AND status IN ('pending','accepted')",
          [actor, input.tripId],
        );
        if (pending.rows[0]) throw new RideRequestError("already_requested");
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO ride_requests(id,trip_id,passenger_id,request_id,trip_version,created_at,updated_at,trip_snapshot) VALUES($1,$2,$3,$4,$5,$6,$6,$7::jsonb) ON CONFLICT(passenger_id,request_id) DO NOTHING RETURNING id",
          [
            crypto.randomUUID(),
            input.tripId,
            actor,
            input.requestId,
            trip.version,
            now,
            JSON.stringify(snapshot(trip)),
          ],
        );
        if (inserted.rows[0])
          return {
            request: await byId(client, inserted.rows[0].id),
            created: true,
          };
        const collision = await client.query<Row>(
          `${select} WHERE r.passenger_id=$1 AND r.request_id=$2`,
          [actor, input.requestId],
        );
        if (!collision.rows[0] || collision.rows[0].trip_id !== input.tripId)
          throw new RideRequestError("request_reused");
        return { request: dto(collision.rows[0]), created: false };
      });
    },
    async cancel(actor, id, now) {
      return transaction(url, async (client) => {
        const found = await client.query<{ trip_id: string }>(
          "SELECT trip_id FROM ride_requests WHERE id=$1 AND passenger_id=$2",
          [id, actor],
        );
        if (!found.rows[0]) throw new RideRequestError("request_not_found");
        const trip = (
          await client.query<TripRow>(`${tripSelect} WHERE id=$1 FOR UPDATE`, [
            found.rows[0].trip_id,
          ])
        ).rows[0];
        const row = (
          await client.query<Row>(
            `${select} WHERE r.id=$1 AND r.passenger_id=$2`,
            [id, actor],
          )
        ).rows[0];
        if (!row) throw new RideRequestError("request_not_found");
        if (row.status === "cancelled") return dto(row);
        if (row.status === "rejected")
          throw new RideRequestError("request_not_pending");
        if (row.status === "accepted") {
          if (
            (
              await client.query(
                "SELECT 1 FROM journeys WHERE trip_id=$1 AND status IN ('travelling','arrived','completed')",
                [trip.id],
              )
            ).rowCount
          )
            throw new RideRequestError("cancellation_closed");
          if (trip.status !== "active" || trip.departure_at <= now)
            throw new RideRequestError("cancellation_closed");
          const released = await client.query(
            "UPDATE trips SET seats_booked=seats_booked-1,updated_at=$2 WHERE id=$1 AND seats_booked>0",
            [trip.id, now],
          );
          if (released.rowCount !== 1) throw new Error("SEAT_INVARIANT");
        }
        await client.query(
          "UPDATE ride_requests SET status='cancelled',updated_at=$3 WHERE id=$1 AND passenger_id=$2 AND status IN ('pending','accepted')",
          [id, actor, now],
        );
        return byId(client, id);
      });
    },
    async decide(actor, id, input, now) {
      return transaction(url, async (client) => {
        const target = await client.query<{ trip_id: string }>(
          "SELECT r.trip_id FROM ride_requests r JOIN trips t ON t.id=r.trip_id WHERE r.id=$1 AND t.owner_id=$2",
          [id, actor],
        );
        if (!target.rows[0]) throw new RideRequestError("request_not_found");
        const trip = (
          await client.query<TripRow>(`${tripSelect} WHERE id=$1 FOR UPDATE`, [
            target.rows[0].trip_id,
          ])
        ).rows[0];
        const row = (await client.query<Row>(`${select} WHERE r.id=$1`, [id]))
          .rows[0];
        if (!row || trip.owner_id !== actor)
          throw new RideRequestError("request_not_found");
        const state = input.decision === "accept" ? "accepted" : "rejected";
        if (row.status === state) return dto(row);
        if (row.status !== "pending")
          throw new RideRequestError("request_not_pending");
        if (input.decision === "accept") {
          if (
            (
              await client.query(
                "SELECT 1 FROM journeys WHERE trip_id=$1 AND status IN ('travelling','arrived','completed')",
                [trip.id],
              )
            ).rowCount
          )
            throw new RideRequestError("trip_unavailable");
          if (enforceSafety)
            await safetyForRequest(client, trip.id, row.passenger_id);
          if (!available(trip, now))
            throw new RideRequestError("trip_unavailable");
          if (row.trip_version !== trip.version)
            throw new RideRequestError("trip_changed");
          const booked = await client.query(
            "UPDATE trips SET seats_booked=seats_booked+1,updated_at=$2 WHERE id=$1 AND seats_booked<seats_offered",
            [trip.id, now],
          );
          if (booked.rowCount !== 1)
            throw new RideRequestError("trip_unavailable");
        }
        await client.query(
          "UPDATE ride_requests SET status=$2,decided_at=$3,updated_at=$3,rejection_reason=$4 WHERE id=$1 AND status='pending'",
          [
            id,
            state,
            now,
            input.decision === "reject" ? input.reason || null : null,
          ],
        );
        return byId(client, id);
      });
    },
    async list(actor, kind, cursor) {
      return withDatabase(url, async (_db, client) => {
        const condition =
          kind === "mine" ? "r.passenger_id=$1" : "t.owner_id=$1";
        const values = cursor
          ? [actor, new Date(cursor.createdAt), cursor.id]
          : [actor];
        const { rows } = await client.query<Row>(
          `${select} WHERE ${condition}${cursor ? " AND (r.created_at,r.id)<($2,$3::uuid)" : ""} ORDER BY r.created_at DESC,r.id DESC LIMIT 21`,
          values,
        );
        const requests = rows.slice(0, 20).map(dto),
          last = requests.at(-1);
        return {
          requests,
          nextCursor:
            rows.length > 20 && last
              ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
                  .replaceAll("+", "-")
                  .replaceAll("/", "_")
                  .replaceAll("=", "")
              : null,
        };
      });
    },
    async context(actor, tripId, now) {
      return withDatabase(url, async (_db, client) => {
        const tripResult = await client.query<TripRow>(
          `${tripSelect} WHERE id=$1`,
          [tripId],
        );
        const trip = tripResult.rows[0];
        if (!trip) throw new RideRequestError("trip_not_found");
        const { rows } = await client.query<Row>(
          `${select} WHERE r.passenger_id=$1 AND r.trip_id=$2 ORDER BY (r.status IN ('pending','accepted')) DESC,r.created_at DESC,r.id DESC LIMIT 1`,
          [actor, tripId],
        );
        const request = rows[0] ? dto(rows[0]) : null,
          isOwner = trip.owner_id === actor;
        if (!available(trip, now) && !isOwner && !request)
          throw new RideRequestError("trip_not_found");
        return {
          isOwner,
          canRequest:
            !isOwner &&
            available(trip, now) &&
            !["pending", "accepted"].includes(request?.status ?? ""),
          request,
        };
      });
    },
  };
}
