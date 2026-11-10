import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { withDatabase, trips } from "@coago/db";
import {
  tripSchema,
  type Trip,
  type TripDraft,
  type CreateTrip,
  type UpdateTrip,
  type CancelTrip,
  type TripCursor,
  type TripList,
} from "@coago/contracts";
import { hash } from "../auth/crypto";
export type TripErrorCode =
  | "trip_not_found"
  | "trip_conflict"
  | "trip_not_editable"
  | "departure_in_past"
  | "request_reused";
export class TripError extends Error {
  constructor(public code: TripErrorCode) {
    super(code);
  }
}
export interface TripStore {
  list(owner: string, cursor?: TripCursor): Promise<TripList>;
  create(
    owner: string,
    input: CreateTrip,
    now: Date,
  ): Promise<{ trip: Trip; created: boolean }>;
  update(
    owner: string,
    id: string,
    input: UpdateTrip,
    now: Date,
  ): Promise<Trip>;
  cancel(
    owner: string,
    id: string,
    input: CancelTrip,
    now: Date,
  ): Promise<Trip>;
}
export function draftValues(input: TripDraft) {
  return {
    originProvince: input.originProvince,
    destinationProvince: input.destinationProvince,
    departureAt: new Date(input.departureAt),
    pickupPoint: input.pickupPoint,
    dropoffPoint: input.dropoffPoint,
    seats: input.seats,
    vehicleModel: input.vehicleModel,
    vehicleColor: input.vehicleColor,
    contributionSatang: input.contributionSatang,
    luggageNotes: input.luggageNotes,
    conditions: input.conditions,
  };
}
function dto(row: typeof trips.$inferSelect): Trip {
  return tripSchema.parse({
    id: row.id,
    originProvince: row.originProvince,
    destinationProvince: row.destinationProvince,
    departureAt: row.departureAt.toISOString(),
    pickupPoint: row.pickupPoint,
    dropoffPoint: row.dropoffPoint,
    seats: row.seats,
    vehicleModel: row.vehicleModel,
    vehicleColor: row.vehicleColor,
    contributionSatang: row.contributionSatang,
    luggageNotes: row.luggageNotes,
    conditions: row.conditions,
    status: row.status,
    version: row.version,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function checkEditable(
  row: typeof trips.$inferSelect | undefined,
  now: Date,
): never {
  if (!row) throw new TripError("trip_not_found");
  if (row.status !== "active") throw new TripError("trip_not_editable");
  if (row.departureAt <= now) throw new TripError("departure_in_past");
  throw new TripError("trip_conflict");
}
function ownerTrip(owner: string, id: string) {
  return and(eq(trips.id, id), eq(trips.ownerId, owner));
}
export function postgresTripStore(url: string): TripStore {
  return {
    async list(owner, cursor) {
      return withDatabase(url, async (db) => {
        const condition = cursor
          ? and(
              eq(trips.ownerId, owner),
              or(
                lt(trips.createdAt, new Date(cursor.createdAt)),
                and(
                  eq(trips.createdAt, new Date(cursor.createdAt)),
                  lt(trips.id, cursor.id),
                ),
              ),
            )
          : eq(trips.ownerId, owner);
        const rows = await db
          .select()
          .from(trips)
          .where(condition)
          .orderBy(desc(trips.createdAt), desc(trips.id))
          .limit(21);
        const page = rows.slice(0, 20).map(dto),
          last = page.at(-1);
        return {
          trips: page,
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
    async create(owner, input, now) {
      const values = draftValues(input),
        fingerprint = await hash(JSON.stringify(values));
      return withDatabase(url, async (db) =>
        db.transaction(async (tx) => {
          const existing = await tx
            .select()
            .from(trips)
            .where(
              and(
                eq(trips.ownerId, owner),
                eq(trips.requestId, input.requestId),
              ),
            );
          if (existing[0]) {
            if (existing[0].payloadHash !== fingerprint)
              throw new TripError("request_reused");
            return { trip: dto(existing[0]), created: false };
          }
          if (values.departureAt <= now)
            throw new TripError("departure_in_past");
          const inserted = await tx
            .insert(trips)
            .values({
              ...values,
              id: crypto.randomUUID(),
              ownerId: owner,
              requestId: input.requestId,
              payloadHash: fingerprint,
              status: "active",
              version: 1,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: [trips.ownerId, trips.requestId] })
            .returning();
          if (inserted[0]) return { trip: dto(inserted[0]), created: true };
          const [row] = await tx
            .select()
            .from(trips)
            .where(
              and(
                eq(trips.ownerId, owner),
                eq(trips.requestId, input.requestId),
              ),
            );
          if (!row || row.payloadHash !== fingerprint)
            throw new TripError("request_reused");
          return { trip: dto(row), created: false };
        }),
      );
    },
    async update(owner, id, input, now) {
      if (new Date(input.departureAt) <= now)
        throw new TripError("departure_in_past");
      return withDatabase(url, async (db) => {
        const rows = await db
          .update(trips)
          .set({
            ...draftValues(input),
            version: sql`${trips.version}+1`,
            updatedAt: now,
          })
          .where(
            and(
              ownerTrip(owner, id),
              eq(trips.version, input.version),
              eq(trips.status, "active"),
              gt(trips.departureAt, now),
            ),
          )
          .returning();
        if (rows[0]) return dto(rows[0]);
        const [existing] = await db
          .select()
          .from(trips)
          .where(ownerTrip(owner, id));
        return checkEditable(existing, now);
      });
    },
    async cancel(owner, id, input, now) {
      return withDatabase(url, async (db) => {
        const rows = await db
          .update(trips)
          .set({
            status: "cancelled",
            cancellationReason: input.reason,
            version: sql`${trips.version}+1`,
            updatedAt: now,
          })
          .where(
            and(
              ownerTrip(owner, id),
              eq(trips.version, input.version),
              eq(trips.status, "active"),
              gt(trips.departureAt, now),
            ),
          )
          .returning();
        if (rows[0]) return dto(rows[0]);
        const [existing] = await db
          .select()
          .from(trips)
          .where(ownerTrip(owner, id));
        if (
          existing?.status === "cancelled" &&
          existing.cancellationReason === input.reason
        )
          return dto(existing);
        return checkEditable(existing, now);
      });
    },
  };
}
