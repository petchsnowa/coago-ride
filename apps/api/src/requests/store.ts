import type pg from "pg";
import { withDatabase } from "@coago/db";
import {
  rideRequestSchema,
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
      | "request_reused",
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
const select = `SELECT r.id,r.trip_id,r.passenger_id,r.request_id,r.status,r.seats_requested,r.trip_version,r.created_at,r.updated_at,u.display_name AS passenger_name,t.origin_province,t.destination_province,t.departure_at,t.seats_offered,t.vehicle_model,t.vehicle_color,t.contribution_satang,t.status AS trip_status,t.version AS current_version FROM ride_requests r JOIN trips t ON t.id=r.trip_id JOIN users u ON u.id=r.passenger_id`;
function dto(row: Row): RideRequest {
  return rideRequestSchema.parse({
    id: row.id,
    status: row.status,
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
      seats: row.seats_offered,
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
  id: string;
  owner_id: string;
  status: string;
  seats_offered: number;
  version: number;
  departure_at: Date;
};
const available = (trip: TripRow, now: Date) =>
  trip.status === "active" && trip.seats_offered > 0 && trip.departure_at > now;
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
export function postgresRideRequestStore(url: string): RideRequestStore {
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
          "SELECT id,owner_id,status,seats_offered,version,departure_at FROM trips WHERE id=$1 FOR UPDATE",
          [input.tripId],
        );
        const trip = locked.rows[0];
        if (!trip) throw new RideRequestError("trip_not_found");
        if (trip.owner_id === actor) throw new RideRequestError("own_trip");
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
        if (!available(trip, now))
          throw new RideRequestError("trip_unavailable");
        const pending = await client.query(
          "SELECT id FROM ride_requests WHERE passenger_id=$1 AND trip_id=$2 AND status='pending'",
          [actor, input.tripId],
        );
        if (pending.rows[0]) throw new RideRequestError("already_requested");
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO ride_requests(id,trip_id,passenger_id,request_id,trip_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(passenger_id,request_id) DO NOTHING RETURNING id",
          [
            crypto.randomUUID(),
            input.tripId,
            actor,
            input.requestId,
            trip.version,
            now,
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
        await client.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [
          found.rows[0].trip_id,
        ]);
        await client.query(
          "UPDATE ride_requests SET status='cancelled',updated_at=$3 WHERE id=$1 AND passenger_id=$2 AND status='pending'",
          [id, actor, now],
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
          "SELECT id,owner_id,status,seats_offered,version,departure_at FROM trips WHERE id=$1",
          [tripId],
        );
        const trip = tripResult.rows[0];
        if (!trip) throw new RideRequestError("trip_not_found");
        const { rows } = await client.query<Row>(
          `${select} WHERE r.passenger_id=$1 AND r.trip_id=$2 ORDER BY (r.status='pending') DESC,r.created_at DESC,r.id DESC LIMIT 1`,
          [actor, tripId],
        );
        const request = rows[0] ? dto(rows[0]) : null,
          isOwner = trip.owner_id === actor;
        if (!available(trip, now) && !isOwner && !request)
          throw new RideRequestError("trip_not_found");
        return {
          isOwner,
          canRequest:
            !isOwner && available(trip, now) && request?.status !== "pending",
          request,
        };
      });
    },
  };
}
